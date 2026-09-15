const express = require('express');
const db = require('../db');
const { requireAuth, quoteAccess } = require('../middleware/auth');
const { expandEngineeringMolds } = require('../services/engineeringMolds');

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

async function loadConfirmedQuote(user, quoteId) {
  const access = await quoteAccess(user, quoteId);
  if (access.status !== 200) return { error: access.status };
  const quote = await db.prepare(`SELECT q.*, c.confirmed_price, c.confirmed_qty, c.confirmed_by, c.confirmed_at
    FROM quotes q JOIN quote_customer_confirmations c ON c.quote_id = q.id
    WHERE q.id = ? ${activeQuotePredicate} AND c.status = 'confirmed'`).get(quoteId);
  return quote ? { quote } : { error: 409 };
}

async function createVersion(quoteId, source, user, versionNo, label) {
  const info = await db.prepare(`INSERT INTO quote_verification_versions
    (quote_id, version_no, label, parent_version_id, source_type, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'drafting', ?) RETURNING id`)
    .get(quoteId, versionNo, label, source.parentVersionId || null, source.type, actorName(user));
  const versionId = Number(info.id);
  const insertSection = db.prepare(`INSERT INTO quote_verification_sections
    (version_id, dept, payload_json, status) VALUES (?, ?, ?, ?)`);
  for (const section of source.sections) {
    await insertSection.run(versionId, section.dept, section.payload_json || '{}', source.sectionStatus || 'empty');
  }
  return versionId;
}

async function ensureCaseAndFirstVersion(quote, user) {
  const tx = db.transaction(async () => {
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
      }, user, 1, 'V1');
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
  await db.prepare(`UPDATE quote_verification_versions SET status=?, updated_at=datetime('now') WHERE id=?`)
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

router.get('/', async (req, res) => {
  const totalDepts = Number((await db.prepare('SELECT COUNT(*) AS n FROM departments').get()).n);
  let rows;
  if (isAdmin(req.user)) {
    rows = await db.prepare(`SELECT q.id, q.quote_no, q.product_name, q.version, q.customer,
      c.confirmed_price, c.confirmed_qty, c.confirmed_at,
      v.id AS current_version_id, v.label AS current_version_label, v.category AS current_version_category,
      v.status AS verification_status,
      v.updated_at,
      COALESCE((SELECT COUNT(*) FROM quote_verification_versions vx WHERE vx.quote_id=q.id), 0) AS version_count,
      COALESCE((SELECT COUNT(*) FROM quote_verification_sections sx WHERE sx.version_id=v.id AND sx.status='approved'), 0) AS approved_count
      FROM quotes q JOIN quote_customer_confirmations c ON c.quote_id=q.id
      LEFT JOIN quote_verification_versions v ON v.id=(
        SELECT vx.id FROM quote_verification_versions vx WHERE vx.quote_id=q.id ORDER BY vx.version_no DESC LIMIT 1
      )
      WHERE q.factory_code=? ${activeQuotePredicate} AND c.status='confirmed'
      ORDER BY c.confirmed_at DESC, q.id DESC`).all(req.user.active_factory_code);
  } else {
    const customers = (await db.prepare('SELECT customer FROM user_customers WHERE user_id=?').all(req.user.id)).map(row => row.customer);
    if (!customers.length) return res.json({ rows: [], total_depts: totalDepts });
    const marks = customers.map(() => '?').join(',');
    rows = await db.prepare(`SELECT q.id, q.quote_no, q.product_name, q.version, q.customer,
      c.confirmed_price, c.confirmed_qty, c.confirmed_at,
      v.id AS current_version_id, v.label AS current_version_label, v.category AS current_version_category,
      v.status AS verification_status,
      v.updated_at,
      COALESCE((SELECT COUNT(*) FROM quote_verification_versions vx WHERE vx.quote_id=q.id), 0) AS version_count,
      COALESCE((SELECT COUNT(*) FROM quote_verification_sections sx WHERE sx.version_id=v.id AND sx.status='approved'), 0) AS approved_count
      FROM quotes q JOIN quote_customer_confirmations c ON c.quote_id=q.id
      LEFT JOIN quote_verification_versions v ON v.id=(
        SELECT vx.id FROM quote_verification_versions vx WHERE vx.quote_id=q.id ORDER BY vx.version_no DESC LIMIT 1
      )
      WHERE q.factory_code=? ${activeQuotePredicate} AND c.status='confirmed' AND q.customer IN (${marks})
      ORDER BY c.confirmed_at DESC, q.id DESC`).all(req.user.active_factory_code, ...customers);
  }
  res.json({ rows: rows.map(row => ({ ...row, total_depts: totalDepts })) });
});

router.post('/:quoteId/versions', async (req, res) => {
  if (!canManageVersions(req.user)) return res.status(403).json({ error: '只有业务、工程或管理员可以创建核价版本' });
  const quoteId = Number(req.params.quoteId);
  const loaded = await loadConfirmedQuote(req.user, quoteId);
  if (loaded.error) return res.status(loaded.error).json({ error: '报价未确认或无权操作' });
  await ensureCaseAndFirstVersion(loaded.quote, req.user);
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
    const versionId = await createVersion(quoteId, source, req.user, versionNo, label);
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
  res.json({
    quote: loaded.quote,
    baseline,
    versions,
    selected_version: selectedVersion,
    sections: sections.map(section => ({
      ...section,
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
  await db.prepare(`UPDATE quote_verification_sections
    SET payload_json=?, status=CASE WHEN ?=1 THEN 'filled' ELSE status END,
      filled_by=?, filled_at=datetime('now') WHERE id=?`)
    .run(payloadJson, submit ? 1 : 0, actorName(req.user), sectionId);
  const status = await recalculateVersionStatus(versionId);
  await db.prepare(`UPDATE quote_verifications SET status='in_progress', updated_by=?, updated_at=datetime('now') WHERE quote_id=?`)
    .run(actorName(req.user), section.quote_id);
  if (submit) {
    await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
      VALUES (?, ?, ?, 'verification_submit', ?)`)
      .run(section.quote_id, section.dept, actorName(req.user), `${section.version_label} 提交部门核价审核`);
  }
  res.json({ ok: true, status });
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
  await db.prepare(`UPDATE quote_verification_sections SET status=?, reviewed_by=?,
    reviewed_at=datetime('now'), review_comment=? WHERE id=?`)
    .run(action === 'approve' ? 'approved' : 'rejected', actorName(req.user), String(comment || '').slice(0, 1000) || null, sectionId);
  const status = await recalculateVersionStatus(versionId);
  await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
    VALUES (?, ?, ?, ?, ?)`)
    .run(section.quote_id, section.dept, actorName(req.user), `verification_${action}`, `${section.version_label}${comment ? `：${String(comment).slice(0, 500)}` : ''}`);
  res.json({ ok: true, status });
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
  await db.prepare(`UPDATE quote_verification_sections SET status='filled', review_comment=? WHERE id=?`)
    .run(reason ? `【解除审核】${reason}` : '【解除审核】', sectionId);
  const status = await recalculateVersionStatus(versionId);
  await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
    VALUES (?, ?, ?, 'verification_reopen', ?)`)
    .run(section.quote_id, section.dept, actorName(req.user), `${section.version_label}${reason ? `：${reason}` : ''}`);
  res.json({ ok: true, status });
});

router.post('/versions/:versionId/complete', async (req, res) => {
  if (!canManageVersions(req.user)) return res.status(403).json({ error: '只有业务、工程或管理员可以完成核价版本' });
  const versionId = Number(req.params.versionId);
  const version = await db.prepare('SELECT * FROM quote_verification_versions WHERE id=?').get(versionId);
  if (!version) return res.status(404).json({ error: '核价版本不存在' });
  const access = await quoteAccess(req.user, version.quote_id);
  if (access.status !== 200) return res.status(access.status).json({ error: '无权操作该核价任务' });
  if (version.status === 'completed') return res.json({ ok: true, status: 'completed' });
  const counts = await db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved
    FROM quote_verification_sections WHERE version_id=?`).get(versionId);
  if (!Number(counts.total) || Number(counts.approved || 0) !== Number(counts.total)) {
    return res.status(409).json({ error: '所有部门审核通过后才能完成核价版本' });
  }
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  await db.prepare(`UPDATE quote_verification_versions SET status='completed', note=?, completed_by=?,
    completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(note || version.note || null, actorName(req.user), versionId);
  await db.prepare(`UPDATE quote_verifications SET status='completed', note=?, updated_by=?, updated_at=datetime('now') WHERE quote_id=?`)
    .run(note || null, actorName(req.user), version.quote_id);
  await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail)
    VALUES (?, ?, ?, 'verification_complete', ?)`)
    .run(version.quote_id, req.user.dept, actorName(req.user), `完成并锁定 ${version.label}`);
  res.json({ ok: true, status: 'completed' });
});

module.exports = router;
