const {gzipSync}=require('node:zlib');
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),path=require('node:path');
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('用法: node scripts/export-verification-transfer.js 源.db 输出.json');
const db=new DatabaseSync(input,{readOnly:true}),records=[];
for(const q of db.prepare("SELECT * FROM quotes WHERE deleted_at IS NULL ORDER BY id").all()){
 const source=db.prepare("SELECT payload_json FROM quote_sections WHERE quote_id=? AND dept='sales'").get(q.id);if(!JSON.parse(source?.payload_json||'{}').legacy_import)continue;
 const check=db.prepare('SELECT baseline_json FROM quote_verifications WHERE quote_id=?').get(q.id);if(!check)continue;
 const baseline=JSON.parse(check.baseline_json);delete baseline.quote?.id;
 const versions=db.prepare("SELECT * FROM quote_verification_versions WHERE quote_id=? AND status<>'cancelled' ORDER BY version_no").all(q.id);
 records.push({quote:Object.fromEntries(['quote_no','product_name','version','customer','qty'].map(k=>[k,q[k]])),confirmation:db.prepare('SELECT confirmed_price,confirmed_qty FROM quote_customer_confirmations WHERE quote_id=?').get(q.id),baseline,versions:versions.map(v=>({version_no:v.version_no,label:v.label,category:v.category,status:v.status,source_type:v.source_type,note:v.note,created_by:v.created_by,created_at:v.created_at,updated_at:v.updated_at,completed_by:v.completed_by,completed_at:v.completed_at,parent_version_no:versions.find(p=>p.id===v.parent_version_id)?.version_no,sections:db.prepare('SELECT * FROM quote_verification_sections WHERE version_id=? ORDER BY id').all(v.id).map(s=>({dept:s.dept,payload:JSON.parse(s.payload_json||'{}'),status:s.status,filled_by:s.filled_by,filled_at:s.filled_at,reviewed_by:s.reviewed_by,reviewed_at:s.reviewed_at,review_comment:s.review_comment}))}))});
}
db.close();fs.mkdirSync(path.dirname(output),{recursive:true});const json=/\.jsonl(?:\.gz)?$/.test(output)
 ?[JSON.stringify({format:'rr-verification-transfer-jsonl-v1'}),...records.map(r=>JSON.stringify(r))].join('\n')+'\n'
 :JSON.stringify({format:'rr-verification-transfer-v1',created_at:new Date().toISOString(),records});
fs.writeFileSync(output,output.endsWith('.gz')?gzipSync(json):json,{mode:0o600});console.log(JSON.stringify({records:records.length,customers:[...new Set(records.map(r=>r.quote.customer))],output}));
