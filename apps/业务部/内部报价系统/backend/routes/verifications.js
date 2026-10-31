const {lockQuote}=require('../services/quoteFreeze');
const {resolveWorkshop, workshopName, fixedWorkshop} = require('../services/verificationWorkshops');
const {payloadRevision,validRevision,assertRevision,saveMetadataSql} = require('../services/verificationMetadata');
const express = require('express');
const db = require('../db');
const { requireAuth, quoteAccess, canEditDepartment, hasMenuPermission } = require('../middleware/auth');
const { expandEngineeringMolds } = require('../services/engineeringMolds');
const { sectionRevision, assertSectionRevision, saveVerificationSection, nextSectionTime, withVerificationVersion } = require('../services/verificationSectionSave');

const {DEFAULT_COSTING_BASIS,normalizeCostingBasis,applyCostingBasisPayload}=require('../services/costingBasis');
const {upgradeLegacySectionsForCalculation}=require('../services/legacyFormula');
const {prepareWorkbookChanges,prepareNativeSectionPayload}=require('../services/excelWorkbookEdit');
const {reviewState,prepareWorkbookReview}=require('../services/workbookReview');
const router = express.Router();
router.use(requireAuth);

const activeQuotePredicate = 'AND q.deleted_at IS NULL';

const parseJson = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

const actorName = user => user.name || user.display_name || user.username;
const isAdmin = user => user.role === 'admin' || Boolean(user.perms?.['账号管理']?.can_admin);
const canManageVersions = user => isAdmin(user) || ['sales', 'engineering'].includes(user.dept);
const canOperateDepartment = (user, department) => department === user.dept
  || ['sales', 'engineering'].includes(user.dept) || isAdmin(user);
const canReviewDepartment = (user, department) => ['supervisor', 'admin'].includes(user.role)
  && canOperateDepartment(user, department);
const canReviewWorkbookDepartment = (user, department) => canReviewDepartment(user, department)
  && hasMenuPermission(user, require('../permissions/menu_catalog').DEPT_TO_MENU[department], 'review');

async function assertNativeReviewPermission(user, versionId, dept) {
  const sales = await db.prepare("SELECT payload_json FROM quote_verification_sections WHERE version_id=? AND dept='sales'").get(versionId);
  if (parseJson(sales?.payload_json, {}).legacy_import?.excel_model && !canReviewWorkbookDepartment(user, dept)) {
    throw Object.assign(new Error('没有该部门原表核价的审核权限'), { status: 403 });
  }
}

async function loadConfirmedQuote(user, quoteId) {
  const access = await quoteAccess(user, quoteId);
  if (access.status !== 200) return { error: access.status };
  const quote = await db.prepare(`SELECT q.*, k.origin AS verification_origin, c.confirmed_price, c.confirmed_qty, c.confirmed_by, c.confirmed_at
    FROM quotes q LEFT JOIN quote_customer_confirmations c ON c.quote_id = q.id
    LEFT JOIN quote_verifications k ON k.quote_id=q.id
    WHERE q.id = ? ${activeQuotePredicate} AND (c.status = 'confirmed' OR k.origin = 'direct')`).get(quoteId);
  return quote ? { quote } : { error: 409 };
}

async function loadCostingBasis(factoryCode) {
  const row = await db.prepare(`SELECT data_json FROM factory_ref_tables
    WHERE factory_code=? AND key='costing_basis'`).get(factoryCode);
  try {
    return normalizeCostingBasis(row?.data_json ? JSON.parse(row.data_json) : DEFAULT_COSTING_BASIS);
  } catch {
    return normalizeCostingBasis(DEFAULT_COSTING_BASIS);
  }
}

async function createVersion(quoteId, source, user, versionNo, label, costingBasis = null) {
  const info = await db.prepare(`INSERT INTO quote_verification_versions
    (quote_id, version_no, label, parent_version_id, source_type, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'drafting', ?) RETURNING id`)
    .get(quoteId, versionNo, label, source.parentVersionId || null, source.type, actorName(user));
  const versionId = Number(info.id);
  const insertSection = db.prepare(`INSERT INTO quote_verification_sections
    (version_id, dept, payload_json, status) VALUES (?, ?, ?, ?)`);
  let preparedSections = source.sections.map(section => ({
    ...section,
    payload: parseJson(section.payload_json || '{}', {}),
  }));
  if (costingBasis) {
    // Establish the new version's starting basis before reconciling imported
    // Excel amounts. Otherwise the basis update itself makes a fresh copy
    // disagree with the source before anyone has edited it.
    preparedSections = upgradeLegacySectionsForCalculation(preparedSections
      .map(section => ({
        ...section,
        payload: applyCostingBasisPayload(section.dept, section.payload, costingBasis).payload,
      })), costingBasis);
  }
  for (const section of preparedSections) {
    const payload = section.payload;
    await insertSection.run(versionId, section.dept, JSON.stringify(payload), source.sectionStatus || 'empty');
  }
  return versionId;
}

async function ensureCaseAndFirstVersion(quote, user) {
  const tx = db.transaction(async () => {
    // Serialize automatic initialization with confirmation revocation.
    await lockQuote(db, Number(quote.id));
    const confirmation = await db.prepare('SELECT status FROM quote_customer_confirmations WHERE quote_id=?').get(quote.id);
    const direct = await db.prepare("SELECT quote_id FROM quote_verifications WHERE quote_id=? AND origin='direct'").get(quote.id);
    if (confirmation?.status !== 'confirmed' && !direct) return null;
    let verification = await db.prepare('SELECT * FROM quote_verifications WHERE quote_id=?').get(quote.id);
    if (!verification) {
      const sections = await db.prepare(`SELECT s.dept, d.name_cn AS dept_name, s.status, s.payload_json
        FROM quote_sections s JOIN departments d ON d.code=s.dept
        WHERE s.quote_id=? ORDER BY d.sort_order`).all(quote.id);
      const baseline = {
        quote,
        sections: sections.map(section => ({
          dept: section.dept,
          dept_name: section.dept_name,
          status: section.status,
          payload: parseJson(section.payload_json, {}),
        })),
        frozen_at: new Date().toISOString(),
      };
      await db.prepare(`INSERT INTO quote_verifications
        (quote_id, baseline_json, verified_values_json, verified_sections_json, status, created_by, updated_by)
        VALUES (?, ?, '{}', '{}', 'not_started', ?, ?)`)
        .run(quote.id, JSON.stringify(baseline), actorName(user), actorName(user));
      verification = await db.prepare('SELECT * FROM quote_verifications WHERE quote_id=?').get(quote.id);
      await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
        VALUES (?, ?, ?, 'verification_create', '从已确认报价生成核价基准快照')`)
        .run(quote.id, user.dept, actorName(user));
    }

    const existingVersion = await db.prepare(`SELECT id FROM quote_verification_versions
      WHERE quote_id=? ORDER BY version_no LIMIT 1`).get(quote.id);
    if (!existingVersion) {
      const baseline = parseJson(verification.baseline_json, { sections: [] });
      const legacySections = parseJson(verification.verified_sections_json, {});
      const legacyCompleted = verification.status === 'completed';
      const sourceSections = (baseline.sections || []).map(section => ({
        dept: section.dept,
        payload_json: JSON.stringify(legacySections[section.dept] || section.payload || {}),
      }));
      const versionId = await createVersion(quote.id, {
        type: 'quote',
        sections: sourceSections,
        sectionStatus: legacyCompleted ? 'approved' : 'empty',
      }, user, 1, 'V1', legacyCompleted ? null : await loadCostingBasis(quote.factory_code));
      if (legacyCompleted) {
        await db.prepare(`UPDATE quote_verification_versions SET status='completed', completed_by=?,
          completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
          .run(verification.updated_by || verification.created_by || actorName(user), versionId);
      }
      await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
        VALUES (?, ?, ?, 'verification_version_create', '创建核价版本 V1')`)
        .run(quote.id, user.dept, actorName(user));
    }
    return db.prepare('SELECT * FROM quote_verifications WHERE quote_id=?').get(quote.id);
  });
  return tx();
}

async function recalculateVersionStatus(versionId) {
  const version = await db.prepare('SELECT status FROM quote_verification_versions WHERE id=?').get(versionId);
  if (!version || ['completed', 'cancelled'].includes(version.status)) return version?.status;
  const counts = await db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
    SUM(CASE WHEN status='filled' THEN 1 ELSE 0 END) AS filled
    FROM quote_verification_sections WHERE version_id=?`).get(versionId);
  const total = Number(counts.total || 0);
  const approved = Number(counts.approved || 0);
  const filled = Number(counts.filled || 0);
  const status = total > 0 && approved === total ? 'ready' : filled > 0 ? 'in_review' : 'drafting';
  await db.prepare(`UPDATE quote_verification_versions SET status=?, updated_at=datetime('now') WHERE id=? AND status NOT IN ('completed','cancelled')`)
    .run(status, versionId);
  return status;
}

async function loadVersionSection(user, versionId, sectionId) {
  const row = await db.prepare(`SELECT s.*, v.quote_id, v.status AS version_status, v.label AS version_label
    FROM quote_verification_sections s
    JOIN quote_verification_versions v ON v.id=s.version_id
    WHERE s.id=? AND s.version_id=?`).get(sectionId, versionId);
  if (!row) return { error: 404 };
  const access = await quoteAccess(user, row.quote_id);
  if (access.status !== 200) return { error: access.status };
  return { row };
}

// Direct costing shares the version/department workflow, without a synthetic
// customer confirmation or a quotation visible in the quotation ledger.
router.post('/', async (req, res) => {
  if (!canManageVersions(req.user)) return res.status(403).json({error:'只有业务、工程或管理员可以新建核价'});
  const body = req.body || {};
  const fields = Object.fromEntries(['quote_no','product_name','customer','version'].map(key=>[key,String(body[key] ?? '').trim()]));
  if (['quote_no','product_name','customer'].some(key=>!fields[key]) || Object.values(fields).some(value=>value.length>200))
    return res.status(400).json({error:'请填写货号、产品名称和客户，每项不超过200字'});
  const qty = body.qty === '' || body.qty == null ? null : Number(body.qty);
  if (qty !== null && (!Number.isSafeInteger(qty) || qty < 0 || qty > 2147483647))
    return res.status(400).json({error:'核价数量须为非负整数，或留空'});
  if (body.quote_type && !['single','mixed'].includes(body.quote_type)) return res.status(400).json({error:'核价类型无效'});
  if (!isAdmin(req.user) && !await db.prepare('SELECT 1 FROM user_customers WHERE user_id=? AND customer=?').get(req.user.id,fields.customer))
    return res.status(403).json({error:'该客户不在当前账号的授权范围内'});
  const factory = await db.prepare('SELECT code FROM factories WHERE code=? AND active=1').get(req.user.active_factory_code);
  if (!factory) return res.status(403).json({error:'当前厂区不可新建核价'});
  try {
    const result = await db.transaction(async () => {
      const info = await db.prepare(`INSERT INTO quotes
        (quote_no,product_name,customer,qty,version,created_by_dept,created_by_name,factory_code)
        VALUES (?,?,?,?,?,?,?,?) RETURNING id`).get(fields.quote_no,fields.product_name,fields.customer,qty,
          fields.version || 'V1',req.user.dept,actorName(req.user),factory.code);
      const id = Number(info.id);
      const quote = await db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
      const departments = await db.prepare('SELECT code,name_cn FROM departments ORDER BY sort_order').all();
      const basis = await loadCostingBasis(factory.code);
      const sections = departments.map(dept=>{
        let payload = dept.code==='sales' ? {header:{quote_no:fields.quote_no,product_name:fields.product_name,customer:fields.customer,qty,version:fields.version || 'V1'}} : {};
        if (dept.code==='sales' && body.quote_type==='mixed') payload.mixed_quote={enabled:true,version:1,mode:'equal',units_per_pack:1,products:[]};
        payload=applyCostingBasisPayload(dept.code,payload,basis).payload;
        return {dept:dept.code,dept_name:dept.name_cn,status:'empty',payload};
      });
      for (const section of sections) await db.prepare(`INSERT INTO quote_sections (quote_id,dept,payload_json) VALUES (?,?,?)`)
        .run(id,section.dept,JSON.stringify(section.payload));
      const baseline={quote:{...quote,verification_origin:'direct'},sections,frozen_at:new Date().toISOString()};
      await db.prepare(`INSERT INTO quote_verifications (quote_id,origin,baseline_json,status,created_by,updated_by)
        VALUES (?,'direct',?,'in_progress',?,?)`).run(id,JSON.stringify(baseline),actorName(req.user),actorName(req.user));
      const versionId=await createVersion(id,{type:'direct',sections:sections.map(section=>({dept:section.dept,payload_json:JSON.stringify(section.payload)}))},req.user,1,'V1',basis);
      await db.prepare(`INSERT INTO audit_log (quote_id,dept,actor,action,detail) VALUES (?,?,?,'verification_direct_create',?)`)
        .run(id,req.user.dept,actorName(req.user),'直接新建核价 V1，按当前核价基准初始化，未生成客价确认');
      return {id,version_id:versionId,label:'V1'};
    })();
    res.status(201).json(result);
  } catch(error) {
    if(error.code==='23505' || String(error.message).includes('UNIQUE'))return res.status(409).json({error:'该货号已有报价或核价任务，请打开现有任务或使用不同货号'});
    throw error;
  }
});

router.get('/', async (req, res) => {
  const totalDepts = Number((await db.prepare('SELECT COUNT(*) AS n FROM departments').get()).n);
  let rows;
  if (isAdmin(req.user)) {
    rows = await db.prepare(`SELECT q.id, q.quote_no, q.product_name, q.version, q.customer,
      k.origin AS verification_origin,
      c.confirmed_price, c.confirmed_qty, c.confirmed_at,
      v.id AS current_version_id, v.label AS current_version_label, v.category AS current_version_category,
      v.status AS verification_status,
      v.updated_at,
      COALESCE((SELECT COUNT(*) FROM quote_verification_versions vx WHERE vx.quote_id=q.id), 0) AS version_count,
      COALESCE((SELECT COUNT(*) FROM quote_verification_sections sx WHERE sx.version_id=v.id AND sx.status='approved'), 0) AS approved_count
      FROM quotes q LEFT JOIN quote_customer_confirmations c ON c.quote_id=q.id
      LEFT JOIN quote_verifications k ON k.quote_id=q.id
      LEFT JOIN quote_verification_versions v ON v.id=(
        SELECT vx.id FROM quote_verification_versions vx WHERE vx.quote_id=q.id AND vx.status<>'cancelled' ORDER BY vx.version_no DESC,vx.id DESC LIMIT 1
      )
      WHERE q.factory_code=? ${activeQuotePredicate} AND (c.status='confirmed' OR k.origin='direct')
      ORDER BY COALESCE(c.confirmed_at,k.created_at) DESC, q.id DESC`).all(req.user.active_factory_code);
  } else {
    const customers = (await db.prepare('SELECT customer FROM user_customers WHERE user_id=?').all(req.user.id)).map(row => row.customer);
    if (!customers.length) return res.json({ rows: [], total_depts: totalDepts, can_assign_workshop: canManageVersions(req.user), can_create: canManageVersions(req.user) });
    const marks = customers.map(() => '?').join(',');
    rows = await db.prepare(`SELECT q.id, q.quote_no, q.product_name, q.version, q.customer,
      k.origin AS verification_origin,
      c.confirmed_price, c.confirmed_qty, c.confirmed_at,
      v.id AS current_version_id, v.label AS current_version_label, v.category AS current_version_category,
      v.status AS verification_status,
      v.updated_at,
      COALESCE((SELECT COUNT(*) FROM quote_verification_versions vx WHERE vx.quote_id=q.id), 0) AS version_count,
      COALESCE((SELECT COUNT(*) FROM quote_verification_sections sx WHERE sx.version_id=v.id AND sx.status='approved'), 0) AS approved_count
      FROM quotes q LEFT JOIN quote_customer_confirmations c ON c.quote_id=q.id
      LEFT JOIN quote_verifications k ON k.quote_id=q.id
      LEFT JOIN quote_verification_versions v ON v.id=(
        SELECT vx.id FROM quote_verification_versions vx WHERE vx.quote_id=q.id AND vx.status<>'cancelled' ORDER BY vx.version_no DESC,vx.id DESC LIMIT 1
      )
      WHERE q.factory_code=? ${activeQuotePredicate} AND (c.status='confirmed' OR k.origin='direct') AND q.customer IN (${marks})
      ORDER BY COALESCE(c.confirmed_at,k.created_at) DESC, q.id DESC`).all(req.user.active_factory_code, ...customers);
  }
  for (const row of rows) {
    const sections = row.current_version_id ? await db.prepare('SELECT * FROM quote_verification_sections WHERE version_id=?').all(row.current_version_id) : [];
    Object.assign(row, resolveWorkshop(row, sections));
    const sales = sections.find(s=>s.dept==='sales');
    row.workshop_revision = sales ? payloadRevision(sales) : null;
  }
  res.json({ rows: rows.map(row => ({ ...row, total_depts: totalDepts })), can_assign_workshop: canManageVersions(req.user), can_create: canManageVersions(req.user) });
});

router.put('/workshops', async (req, res) => {
  if (!canManageVersions(req.user)) return res.status(403).json({error:'只有业务、工程或管理员可以分配车间'});
  const ids = req.body?.version_ids, name = workshopName(req.body?.workshop), expected = req.body?.expected_revisions;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || !name || name === '河源')
    return res.status(400).json({error:'请选择核价版本和有效车间'});
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) || ids.some(id=>!validRevision(expected[id])))
    return res.status(400).json({error:'缺少有效的核价资料版本，请刷新后重试'});
  try {
    const revisions = await db.transaction(async () => {
      const next = {};
      for (const id of [...new Set(ids)].sort((a,b)=>a-b)) {
        const version = await db.prepare(`SELECT v.*,q.deleted_at FROM quote_verification_versions v JOIN quotes q ON q.id=v.quote_id WHERE v.id=?`).get(id);
        if (!version || version.deleted_at || version.status === 'cancelled') throw Object.assign(new Error('核价版本不存在或已取消'),{status:409});
        const access = await quoteAccess(req.user, version.quote_id);
        if (access.status !== 200) throw Object.assign(new Error('无权分配该核价任务'),{status:access.status});
        const latest = await db.prepare("SELECT id FROM quote_verification_versions WHERE quote_id=? AND status<>'cancelled' ORDER BY version_no DESC,id DESC LIMIT 1").get(version.quote_id);
        if (!latest || latest.id !== id) throw Object.assign(new Error('版本已变化，请刷新后重试'),{status:409});
        const quote = await db.prepare('SELECT customer FROM quotes WHERE id=?').get(version.quote_id);
        if (fixedWorkshop(quote) && name !== fixedWorkshop(quote)) throw Object.assign(new Error('该客户核价统一分配华登'),{status:400});
        const sales = await db.prepare("SELECT * FROM quote_verification_sections WHERE version_id=? AND dept='sales'").get(id);
        if (!sales) throw Object.assign(new Error('缺少业务核价信息'),{status:409});
        assertRevision(sales,expected[id]);
        const payload = JSON.parse(sales.payload_json || '{}');
        payload.workshop_assignment = {name, assigned_by:actorName(req.user), assigned_at:new Date().toISOString()};
        const payloadJson = JSON.stringify(payload);
        const saved = await db.prepare(saveMetadataSql).run(payloadJson,sales.id,sales.payload_json);
        if (!saved.changes) throw Object.assign(new Error('核价资料已更新，请刷新后重试'),{status:409});
        await db.prepare(`INSERT INTO audit_log(quote_id,dept,actor,action,detail) VALUES(?,?,?,'verification_workshop_assign',?)`).run(version.quote_id,req.user.dept,actorName(req.user),`${version.label} 分配至 ${name}；核价及审核状态不变`);
        next[id] = payloadRevision({payload_json:payloadJson});
      }
      return next;
    })();
    res.json({ok:true,count:Object.keys(revisions).length,workshop:name,revisions});
  } catch(error) {
    if(error.status)return res.status(error.status).json({error:error.message});
    throw error;
  }
});

router.post('/:quoteId/versions', async (req, res) => {
  if (!canManageVersions(req.user)) return res.status(403).json({ error: '只有业务、工程或管理员可以创建核价版本' });
  const quoteId = Number(req.params.quoteId);
  const loaded = await loadConfirmedQuote(req.user, quoteId);
  if (loaded.error) return res.status(loaded.error).json({ error: '报价未确认或无权操作' });
  if (!await ensureCaseAndFirstVersion(loaded.quote, req.user)) return res.status(409).json({error:'客价确认已撤销，请刷新列表'});
  const latest = await db.prepare(`SELECT * FROM quote_verification_versions
    WHERE quote_id=? ORDER BY version_no DESC LIMIT 1`).get(quoteId);
  if (latest && latest.status !== 'completed') {
    return res.status(409).json({ error: `请先完成 ${latest.label}，再创建下一版本` });
  }

  const requestedSource = req.body?.source_type === 'quote' ? 'quote' : 'version';
  let source;
  if (requestedSource === 'quote') {
    const verification = await db.prepare('SELECT baseline_json FROM quote_verifications WHERE quote_id=?').get(quoteId);
    const baseline = parseJson(verification.baseline_json, { sections: [] });
    source = {
      type: 'quote',
      sections: (baseline.sections || []).map(section => ({ dept: section.dept, payload_json: JSON.stringify(section.payload || {}) })),
    };
  } else {
    const sourceVersionId = Number(req.body?.source_version_id || latest?.id);
    const sourceVersion = await db.prepare(`SELECT * FROM quote_verification_versions
      WHERE id=? AND quote_id=?`).get(sourceVersionId, quoteId);
    if (!sourceVersion || sourceVersion.status !== 'completed') {
      return res.status(409).json({ error: '新版本只能复制已完成的核价版本' });
    }
    source = {
      type: 'version',
      parentVersionId: sourceVersion.id,
      sections: await db.prepare(`SELECT dept, payload_json FROM quote_verification_sections
        WHERE version_id=? ORDER BY id`).all(sourceVersion.id),
    };
  }

  const versionNo = Number(latest?.version_no || 0) + 1;
  const label = `V${versionNo}`;
  const tx = db.transaction(async () => {
    const versionId = await createVersion(quoteId, source, req.user, versionNo, label, await loadCostingBasis(loaded.quote.factory_code));
    await db.prepare(`UPDATE quote_verifications SET status='in_progress', updated_by=?, updated_at=datetime('now') WHERE quote_id=?`)
      .run(actorName(req.user), quoteId);
    await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
      VALUES (?, ?, ?, 'verification_version_create', ?)`)
      .run(quoteId, req.user.dept, actorName(req.user), `创建核价版本 ${label}，来源：${source.type === 'quote' ? '原报价' : latest.label}`);
    return versionId;
  });
  try {
    const versionId = await tx();
    res.json({ id: versionId, label });
  } catch (error) {
    if (error.code === '23505' || String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '核价版本已被其他人创建，请刷新后重试' });
    }
    throw error;
  }
});

router.patch('/versions/:versionId', async (req, res) => {
  if (!canManageVersions(req.user)) return res.status(403).json({ error: '只有业务、工程或管理员可以编辑版本类别' });
  const versionId = Number(req.params.versionId);
  const version = await db.prepare('SELECT id, quote_id, label, category FROM quote_verification_versions WHERE id=?').get(versionId);
  if (!version) return res.status(404).json({ error: '核价版本不存在' });
  const access = await quoteAccess(req.user, version.quote_id);
  if (access.status !== 200) return res.status(access.status).json({ error: '无权编辑该核价版本' });
  const category = String(req.body?.category || '').trim().slice(0, 40) || null;
  await db.prepare("UPDATE quote_verification_versions SET category=?, updated_at=datetime('now') WHERE id=?")
    .run(category, versionId);
  await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
    VALUES (?, ?, ?, 'verification_version_category', ?)`).run(
    version.quote_id,
    req.user.dept,
    actorName(req.user),
    `${version.label} 版本类别：${category || '未设置'}`,
  );
  res.json({ ok: true, category });
});

router.get('/:quoteId', async (req, res) => {
  const quoteId = Number(req.params.quoteId);
  const loaded = await loadConfirmedQuote(req.user, quoteId);
  if (loaded.error) return res.status(loaded.error).json({ error: loaded.error === 409 ? '报价尚未确认，不能创建核价任务' : '无权查看该报价' });
  const verification = await ensureCaseAndFirstVersion(loaded.quote, req.user);
  if (!verification) return res.status(409).json({error:'客价确认已撤销，请刷新列表'});
  const versions = await db.prepare(`SELECT v.*,
    (SELECT COUNT(*) FROM quote_verification_sections s WHERE s.version_id=v.id) AS total_count,
    (SELECT COUNT(*) FROM quote_verification_sections s WHERE s.version_id=v.id AND s.status='approved') AS approved_count
    FROM quote_verification_versions v WHERE v.quote_id=? ORDER BY v.version_no`).all(quoteId);
  const requestedVersionId = Number(req.query.version_id || versions[versions.length - 1]?.id);
  const selectedVersion = versions.find(version => Number(version.id) === requestedVersionId);
  if (!selectedVersion) return res.status(404).json({ error: '核价版本不存在' });
  const sections = await db.prepare(`SELECT s.*, d.name_cn AS dept_name
    FROM quote_verification_sections s JOIN departments d ON d.code=s.dept
    WHERE s.version_id=? ORDER BY d.sort_order`).all(selectedVersion.id);
  const baseline = parseJson(verification.baseline_json, {});
  const engineering = sections.find(section => section.dept === 'engineering');
  const engineeringPayload = parseJson(engineering?.payload_json, {});
  const workbookReview=reviewState(selectedVersion,sections,section=>canReviewWorkbookDepartment(req.user,section.dept));
  res.json({
    can_review_workbook:workbookReview.allowed,workbook_review_ready:workbookReview.ready,workbook_review_token:workbookReview.allowed?workbookReview.token:null,
    quote: loaded.quote,
    baseline,
    versions,
    selected_version: selectedVersion,
    sections: sections.map(section => ({
      ...section,
      revision: sectionRevision(section),
      can_edit: selectedVersion.status !== 'completed' && selectedVersion.status !== 'cancelled'
        && section.status !== 'approved' && canOperateDepartment(req.user, section.dept),
      can_review: selectedVersion.status !== 'completed' && selectedVersion.status !== 'cancelled'
        && canReviewDepartment(req.user, section.dept),
    })),
    engineering_molds: expandEngineeringMolds(engineeringPayload.molds || []),
    can_create_version: canManageVersions(req.user)
      && versions[versions.length - 1]?.status === 'completed',
    can_manage_versions: canManageVersions(req.user),
    can_complete: canManageVersions(req.user) && selectedVersion.status === 'ready',
  });
});

router.put('/versions/:versionId/workbook', async (req, res) => {
  const versionId = Number(req.params.versionId);
  const version = await db.prepare('SELECT * FROM quote_verification_versions WHERE id=?').get(versionId);
  if (!version) return res.status(404).json({ error: '核价版本不存在' });
  const access = await quoteAccess(req.user, version.quote_id);
  if (access.status !== 200) return res.status(access.status).json({ error: '无权操作该核价任务' });
  try {
    const status = await withVerificationVersion(db,versionId,async lockedVersion => {
      const current = await db.prepare('SELECT * FROM quote_verification_versions WHERE id=?').get(versionId);
      if (!current || ['completed', 'cancelled'].includes(current.status)) throw Object.assign(new Error('该核价版本已锁定'), { status: 409 });
      if(['completed','cancelled'].includes(lockedVersion.status))throw Object.assign(new Error('该核价版本已锁定'),{status:409});
      const sections = await db.prepare('SELECT * FROM quote_verification_sections WHERE version_id=?').all(versionId);
      const updates = prepareWorkbookChanges(sections, req.body?.changes,
        section => section.status !== 'approved' && canOperateDepartment(req.user, section.dept)
          && canEditDepartment(req.user, section.dept));
      for (const update of updates) {
        const source = sections.find(section => Number(section.id) === Number(update.id));
        assertSectionRevision(source, req.body?.base_revisions?.[update.id]);
      }
      for (const update of updates) {
        const source = sections.find(section => Number(section.id) === Number(update.id));
        await saveVerificationSection(db, source, update.payload, req.body.submit, actorName(req.user));
      }
      const next = await recalculateVersionStatus(versionId);
      await db.prepare(`UPDATE quote_verifications SET status='in_progress', updated_by=?, updated_at=datetime('now') WHERE quote_id=?`)
        .run(actorName(req.user), version.quote_id);
      await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, ?, ?)`)
        .run(version.quote_id, req.user.dept, actorName(req.user), req.body.submit ? 'verification_submit' : 'verification_workbook_save', `${version.label} 整表${req.body.submit ? '提交审核' : '保存'}`);
      return next;
    });
    res.json({ ok: true, status });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.put('/versions/:versionId/sections/:sectionId', async (req, res) => {
  const versionId = Number(req.params.versionId);
  const sectionId = Number(req.params.sectionId);
  const loaded = await loadVersionSection(req.user, versionId, sectionId);
  if (loaded.error) return res.status(loaded.error).json({ error: loaded.error === 404 ? '核价部门明细不存在' : '无权操作该核价任务' });
  const section = loaded.row;
  if (['completed', 'cancelled'].includes(section.version_status)) return res.status(409).json({ error: '该核价版本已锁定' });
  if (!canOperateDepartment(req.user, section.dept)) return res.status(403).json({ error: '只能填写本部门核价明细' });
  if (section.status === 'approved') return res.status(409).json({ error: '该部门核价已经审核通过，不能修改' });
  const payload = req.body?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return res.status(400).json({ error: '核价部门数据格式不正确' });
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > 2_000_000) return res.status(413).json({ error: '核价部门数据过大' });
  const submit = Boolean(req.body?.submit);
  try {
    const result = await withVerificationVersion(db, versionId, async version => {
      if (['completed', 'cancelled'].includes(version.status)) throw Object.assign(new Error('该核价版本已锁定'), { status: 409 });
      const current = await db.prepare('SELECT * FROM quote_verification_sections WHERE id=? AND version_id=?').get(sectionId, versionId);
      if (!current) throw Object.assign(new Error('核价部门明细不存在'), { status: 404 });
      assertSectionRevision(current, req.body?.base_revision);
      if (current.status === 'approved') throw Object.assign(new Error('该部门核价已经审核通过，不能修改'), { status: 409 });
      const allSections = await db.prepare('SELECT * FROM quote_verification_sections WHERE version_id=?').all(versionId);
      const preparedPayload = prepareNativeSectionPayload(allSections, current.id, payload,
        candidate => Number(candidate.id) === Number(current.id) && candidate.status !== 'approved'
          && canOperateDepartment(req.user, candidate.dept) && canEditDepartment(req.user, candidate.dept));
      await saveVerificationSection(db, current, preparedPayload, submit, actorName(req.user));
      const status = await recalculateVersionStatus(versionId);
      await db.prepare(`UPDATE quote_verifications SET status='in_progress', updated_by=?, updated_at=datetime('now') WHERE quote_id=?`)
        .run(actorName(req.user), section.quote_id);
      if (submit) {
        await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
          VALUES (?, ?, ?, 'verification_submit', ?)`)
          .run(section.quote_id, section.dept, actorName(req.user), `${section.version_label} 提交部门核价审核`);
      }
      const saved = await db.prepare('SELECT * FROM quote_verification_sections WHERE id=? AND version_id=?').get(sectionId, versionId);
      return { ok: true, status, filled_at: saved.filled_at, filled_by: saved.filled_by,
        section_status: saved.status, revision: sectionRevision(saved) };
    });
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post('/versions/:versionId/workbook/review', async (req, res) => {
  const versionId = Number(req.params.versionId);
  const version = await db.prepare('SELECT * FROM quote_verification_versions WHERE id=?').get(versionId);
  if (!version) return res.status(404).json({ error: '核价版本不存在' });
  const access = await quoteAccess(req.user, version.quote_id);
  if (access.status !== 200) return res.status(access.status).json({ error: '无权审核该核价任务' });
  try {
    const result = await withVerificationVersion(db,versionId,async lockedVersion => {
      const current = await db.prepare('SELECT * FROM quote_verification_versions WHERE id=?').get(versionId);
      if (!current) throw Object.assign(new Error('核价版本不存在'), {status:404});
      const sections = await db.prepare('SELECT * FROM quote_verification_sections WHERE version_id=?').all(versionId);
      const pending = prepareWorkbookReview(current, sections,
        section => canReviewWorkbookDepartment(req.user, section.dept), req.body?.token);
      for (const section of pending) {
        await db.prepare(`UPDATE quote_verification_sections SET status='approved', reviewed_by=?,
          reviewed_at=datetime('now'), review_comment=? WHERE id=?`)
          .run(actorName(req.user), '导入核价整表一键审核', section.id);
      }
      const status = await recalculateVersionStatus(versionId);
      if (pending.length) await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
        VALUES (?, ?, ?, 'verification_workbook_approve', ?)`)
        .run(current.quote_id, req.user.dept, actorName(req.user), `${current.label} 整表一键审核通过：${pending.map(s => s.dept).join('、')}`);
      return {ok:true, status, approved_count:pending.length};
    });
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post('/versions/:versionId/sections/:sectionId/review', async (req, res) => {
  const versionId = Number(req.params.versionId);
  const sectionId = Number(req.params.sectionId);
  const loaded = await loadVersionSection(req.user, versionId, sectionId);
  if (loaded.error) return res.status(loaded.error).json({ error: loaded.error === 404 ? '核价部门明细不存在' : '无权审核该核价任务' });
  const section = loaded.row;
  const { action, comment } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '审核操作不正确' });
  if (!canReviewDepartment(req.user, section.dept)) return res.status(403).json({ error: '只有主管可以审核本部门核价' });
  if (['completed', 'cancelled'].includes(section.version_status)) return res.status(409).json({ error: '该核价版本已锁定' });
  if (action === 'approve' && section.status !== 'filled') return res.status(409).json({ error: '该部门尚未提交核价审核' });
  try {
    const status = await withVerificationVersion(db, versionId, async version => {
      if (['completed', 'cancelled'].includes(version.status)) throw Object.assign(new Error('该核价版本已锁定'), { status: 409 });
      const current = await db.prepare('SELECT * FROM quote_verification_sections WHERE id=? AND version_id=?').get(sectionId, versionId);
      if (!current) throw Object.assign(new Error('核价部门明细不存在'), { status: 404 });
      await assertNativeReviewPermission(req.user, versionId, current.dept);
      assertSectionRevision(current, sectionRevision(section));
      if (action === 'approve' && current.status !== 'filled') throw Object.assign(new Error('该部门尚未提交核价审核'), { status: 409 });
      await db.prepare(`UPDATE quote_verification_sections SET status=?, reviewed_by=?,
        reviewed_at=?, review_comment=? WHERE id=?`)
        .run(action === 'approve' ? 'approved' : 'rejected', actorName(req.user), nextSectionTime(current), String(comment || '').slice(0, 1000) || null, sectionId);
      const nextStatus = await recalculateVersionStatus(versionId);
      await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
        VALUES (?, ?, ?, ?, ?)`)
        .run(section.quote_id, section.dept, actorName(req.user), `verification_${action}`, `${section.version_label}${comment ? `：${String(comment).slice(0, 500)}` : ''}`);
      return nextStatus;
    });
    res.json({ ok: true, status });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post('/versions/:versionId/sections/:sectionId/reopen', async (req, res) => {
  const versionId = Number(req.params.versionId);
  const sectionId = Number(req.params.sectionId);
  const loaded = await loadVersionSection(req.user, versionId, sectionId);
  if (loaded.error) return res.status(loaded.error).json({ error: loaded.error === 404 ? '核价部门明细不存在' : '无权操作该核价任务' });
  const section = loaded.row;
  if (!canReviewDepartment(req.user, section.dept)) return res.status(403).json({ error: '只有主管可以解除本部门审核' });
  if (['completed', 'cancelled'].includes(section.version_status)) return res.status(409).json({ error: '该核价版本已锁定' });
  if (section.status !== 'approved') return res.status(409).json({ error: '只能解除已经审核通过的部门核价' });
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  try {
    const status = await withVerificationVersion(db, versionId, async version => {
      if (['completed', 'cancelled'].includes(version.status)) throw Object.assign(new Error('该核价版本已锁定'), { status: 409 });
      const current = await db.prepare('SELECT * FROM quote_verification_sections WHERE id=? AND version_id=?').get(sectionId, versionId);
      if (!current) throw Object.assign(new Error('核价部门明细不存在'), { status: 404 });
      await assertNativeReviewPermission(req.user, versionId, current.dept);
      assertSectionRevision(current, sectionRevision(section));
      if (current.status !== 'approved') throw Object.assign(new Error('只能解除已经审核通过的部门核价'), { status: 409 });
      await db.prepare(`UPDATE quote_verification_sections SET status='filled', review_comment=?, reviewed_at=? WHERE id=?`)
        .run(reason ? `【解除审核】${reason}` : '【解除审核】', nextSectionTime(current), sectionId);
      const nextStatus = await recalculateVersionStatus(versionId);
      await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
        VALUES (?, ?, ?, 'verification_reopen', ?)`)
        .run(section.quote_id, section.dept, actorName(req.user), `${section.version_label}${reason ? `：${reason}` : ''}`);
      return nextStatus;
    });
    res.json({ ok: true, status });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post('/versions/:versionId/complete', async (req, res) => {
  if (!canManageVersions(req.user)) return res.status(403).json({ error: '只有业务、工程或管理员可以完成核价版本' });
  const versionId = Number(req.params.versionId);
  const version = await db.prepare('SELECT * FROM quote_verification_versions WHERE id=?').get(versionId);
  if (!version) return res.status(404).json({ error: '核价版本不存在' });
  const access = await quoteAccess(req.user, version.quote_id);
  if (access.status !== 200) return res.status(access.status).json({ error: '无权操作该核价任务' });
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  try {
    await withVerificationVersion(db, versionId, async current => {
      if (current.status === 'completed') return;
      if (current.status === 'cancelled') throw Object.assign(new Error('该核价版本已锁定'), { status: 409 });
      const counts = await db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved
        FROM quote_verification_sections WHERE version_id=?`).get(versionId);
      if (!Number(counts.total) || Number(counts.approved || 0) !== Number(counts.total)) {
        throw Object.assign(new Error('所有部门审核通过后才能完成核价版本'), { status: 409 });
      }
      await db.prepare(`UPDATE quote_verification_versions SET status='completed', note=?, completed_by=?,
        completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
        .run(note || current.note || null, actorName(req.user), versionId);
      await db.prepare(`UPDATE quote_verifications SET status='completed', note=?, updated_by=?, updated_at=datetime('now') WHERE quote_id=?`)
        .run(note || null, actorName(req.user), current.quote_id);
      await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
        VALUES (?, ?, ?, 'verification_complete', ?)`)
        .run(current.quote_id, req.user.dept, actorName(req.user), `完成并锁定 ${current.label}`);
    });
    res.json({ ok: true, status: 'completed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

module.exports = router;
