const express=require('express');
const db=require('../db');
const {requireAuth,quoteAccess}=require('../middleware/auth');
const {columns,template,buildVerificationRow,customerTotals,buildVerificationWorkbook}=require('../services/verificationSummary');
const {sourceQuantity}=require('../services/sourceSummary');
const router=express.Router();router.use(requireAuth);
const canEditQuantity=u=>Boolean(u.perms?.['账号管理']?.can_admin)||u.role==='admin'||['sales','engineering'].includes(u.dept);
router.put('/quantity',async(req,res)=>{
  if(!canEditQuantity(req.user))return res.status(403).json({error:'只有业务、工程或管理员可以填写接单数量'});
  const {version_id:id,quantity}=req.body||{};
  if(!Number.isSafeInteger(id)||id<=0||!(quantity===null||(Number.isSafeInteger(quantity)&&quantity>=0)))return res.status(400).json({error:'数量须为非负整数，或留空'});
  try{
    await db.transaction(async()=>{
      const v=await db.prepare(`SELECT v.*,q.deleted_at FROM quote_verification_versions v JOIN quotes q ON q.id=v.quote_id WHERE v.id=?`).get(id);
      if(!v||v.deleted_at||v.status==='cancelled')throw Object.assign(new Error('核价版本不可用'),{status:409});
      const access=await quoteAccess(req.user,v.quote_id);
      if(access.status!==200)throw Object.assign(new Error('无权修改此核价数量'),{status:access.status});
      const latest=await db.prepare("SELECT id FROM quote_verification_versions WHERE quote_id=? AND status<>'cancelled' ORDER BY version_no DESC,id DESC LIMIT 1").get(v.quote_id);
      if(latest.id!==id)throw Object.assign(new Error('核价版本已更新，请刷新后填写'),{status:409});
      const s=await db.prepare("SELECT * FROM quote_verification_sections WHERE version_id=? AND dept='sales'").get(id);
      if(!s)throw Object.assign(new Error('缺少业务核价信息'),{status:409});
      const p=JSON.parse(s.payload_json||'{}'),actor=req.user.name||req.user.username;
      p.summary_order_quantity={value:quantity,updated_by:actor,updated_at:new Date().toISOString()};
      const saved=await db.prepare('UPDATE quote_verification_sections SET payload_json=? WHERE id=? AND payload_json=?').run(JSON.stringify(p),s.id,s.payload_json);
      if(!saved.changes)throw Object.assign(new Error('核价资料已更新，请刷新后重试'),{status:409});
      await db.prepare(`INSERT INTO audit_log(quote_id,dept,actor,action,detail) VALUES(?,?,?,'verification_order_quantity',?)`).run(v.quote_id,req.user.dept,actor,`${v.label} 汇总接单数量设为 ${quantity===null?'空白':quantity}；核价单价与完成状态不变`);
    })();
    res.json({ok:true});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}
});

async function loadRows(user,filters={}) {
  const admin=user.role==='admin'||Boolean(user.perms?.['账号管理']?.can_admin);
  const params=[user.active_factory_code];
  let scope='';
  if(!admin){scope=' AND q.customer IN (SELECT customer FROM user_customers WHERE user_id=?)';params.push(user.id);}
  const rows=await db.prepare(`SELECT q.*,v.id AS verification_version_id,v.label AS verification_label,v.status AS verification_status,v.version_no AS verification_version_no
    FROM quotes q JOIN quote_verification_versions v ON v.id=(SELECT vx.id FROM quote_verification_versions vx
    WHERE vx.quote_id=q.id AND vx.status<>'cancelled' ORDER BY vx.version_no DESC,vx.id DESC LIMIT 1)
    WHERE q.deleted_at IS NULL AND q.factory_code=?${scope} ORDER BY q.customer,q.quote_no,q.id`).all(...params);
  const result=[];
  for(const q of rows){
    if(filters.customer&&q.customer!==filters.customer)continue;
    if(filters.status&&q.verification_status!==filters.status)continue;
    if(filters.search&&!`${q.customer} ${q.quote_no} ${q.product_name}`.toLowerCase().includes(String(filters.search).toLowerCase()))continue;
    const sections=await db.prepare('SELECT dept,payload_json FROM quote_verification_sections WHERE version_id=?').all(q.verification_version_id);
    // Every cost comes from the current verification detail. The original
    // summary supplies order quantity only, never cost overrides or comparisons.
    const report=buildVerificationRow(q,{id:q.verification_version_id,label:q.verification_label,status:q.verification_status,version_no:q.verification_version_no},sections,sourceQuantity(q,sections)??undefined);
    if(filters.workshop&&report.workshop!==filters.workshop)continue;
    result.push(report);
  }
  return result;
}
router.get('/',async(req,res)=>{
  const rows=await loadRows(req.user,req.query);
  res.json({columns,rows,customers:customerTotals(rows),can_edit_quantity:canEditQuantity(req.user),quantity_period:'手填数量优先；未手填时沿用原文件数量'});
});
router.get('/export',async(req,res)=>{
  const rows=await loadRows(req.user,req.query),wb=buildVerificationWorkbook(rows);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent('各客核价汇总.xlsx')}`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});
module.exports=router;
module.exports.loadRows=loadRows;
