const core=require('./business-sync-core.cjs');
const commands=require('./authority-commands.cjs');
// Called only AFTER the original server's Basic authentication, and only on loopback.
module.exports=async function(req,res,{load,save,readDisk,enabled}){
 const send=(code,x)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(x));};
 try{
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(403,{error:'拒绝跨站写入'});
  if(!enabled)return send(409,{error:'请停用原系统旧主从同步并启用 businessSync；只允许一套桥接写入'});
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return send(403,{error:'仅允许本机桥接访问'});
  if(req.method==='GET'){const data=core.project(load()),fingerprint=core.fingerprint(data);if(core.fingerprint(core.project(readDisk()))!==fingerprint)return send(409,{error:'原系统内存与磁盘尚未一致，请检查磁盘写入后重试'});return send(200,{data,fingerprint,authorityProtocol:1,authorityEnabled:!!load()._printlinkAuthority?.enabled,receipts:Object.values(load()._printlinkAuthority?.receipts||{})});}
  if(req.method!=='POST')return send(405,{error:'不支持的方法'});
  if(!String(req.headers['content-type']||'').includes('application/json'))return send(415,{error:'需要 JSON 请求'});
  let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>128*1024*1024)return send(413,{error:'业务资料超过 128MB'});chunks.push(c);}
  const input=JSON.parse(Buffer.concat(chunks)),original=load();
  if(input.action==='authority-enable'){
   if(core.fingerprint(core.project(original))!==core.fingerprint(core.project(readDisk())))return send(409,{error:'现场落盘尚未完成'});
   original._printlinkAuthority={...original._printlinkAuthority,enabled:true,receipts:original._printlinkAuthority?.receipts||{}};
   await save(original);if(!readDisk()._printlinkAuthority?.enabled)throw Error('统一记账标记未落盘');return send(200,{ok:true});
  }
  if(input.action==='command'){
   const c=commands.validate(input.command),request=core.fingerprint(c),prior=readDisk()._printlinkAuthority?.receipts?.[c.id];
   if(prior){if(prior.request!==request)throw Error('申请编号重复但内容不同');return send(200,prior);}
   if(core.fingerprint(core.project(original))!==core.fingerprint(core.project(readDisk())))return send(409,{error:'原系统内存与磁盘尚未一致，稍后重试'});
   let next,result,status='applied';
   try{const effective=c.operation==='task'?{...c,value:{...c.value,machine:input.sourceMachine}}:c;
   if(c.operation==='task'&&(!Number.isInteger(input.sourceMachine)||input.sourceMachine<1||input.sourceMachine>50))throw Error('现场机台映射无效');
   const applied=commands.apply(original,effective);next=applied.data;result=applied.result;}catch(e){next=structuredClone(original);status='rejected';result={error:e.message};}
   const receipt={id:c.id,request,status,...result,confirmedAt:new Date().toISOString()};
   next._printlinkAuthority={enabled:true,receipts:{...original._printlinkAuthority?.receipts,[c.id]:receipt}};
   await save(next);
   const disk=readDisk();if(core.fingerprint(core.project(disk))!==core.fingerprint(core.project(next))||core.fingerprint(disk._printlinkAuthority)!==core.fingerprint(next._printlinkAuthority))throw Error('现场落盘校验失败，未确认申请');
   return send(200,receipt);
  }
  if(original._printlinkAuthority?.enabled)return send(409,{error:'原系统已启用统一记账，拒绝旧双向快照覆盖'});
  if(core.fingerprint(core.project(original))!==input.expected||core.fingerprint(core.project(readDisk()))!==input.expected)return send(409,{error:'原系统资料已变化，保留双方版本，稍后重新对账'});
  const next=core.apply(original,input.data);await save(next);
  if(core.fingerprint(core.project(readDisk()))!==core.fingerprint(input.data))throw Error('原系统落盘校验未通过；未确认同步，稍后重新对账');
  send(200,{ok:true});
 }catch(e){send(400,{error:e.message});}
};
