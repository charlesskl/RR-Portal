const express=require('express'),multer=require('multer');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const db=require('../db');
const {requireAuth}=require('../middleware/auth');
const {planFile,applyFile}=require('../services/verificationTransferStream');
const {VERIFICATION_UPLOAD_BYTES,handleVerificationUpload}=require('../services/verificationUpload');
const router=express.Router();
const tempDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'verification-transfer-'));
fs.chmodSync(tempDirectory,0o700);
const upload=multer({storage:multer.diskStorage({
 destination:(_req,_file,done)=>done(null,tempDirectory),
 filename:(_req,_file,done)=>done(null,'verification-transfer-'+randomUUID()+'.tmp'),
}),limits:{fileSize:VERIFICATION_UPLOAD_BYTES,fields:4,fieldSize:1024,files:1,parts:6}});
router.use(requireAuth,(req,res,next)=>req.user.perms?.['账号管理']?.can_admin
 ?next():res.status(403).json({error:'只有系统管理员可以导入客户核价资料'}));
router.post('/',handleVerificationUpload(upload.single('file')),async(req,res)=>{
 try{
  if(!req.file)return res.status(400).json({error:'请选择核价导入包'});
  // Only files created by this upload middleware are read; never accept a path from the client.
  await fs.promises.chmod(req.file.path,0o600);
  const file={path:req.file.path,originalname:path.basename(req.file.originalname)};
  const options={factoryCode:req.user.active_factory_code,actor:req.user.name||req.user.username};
  res.json(req.body.apply==='1'?await applyFile(db,file,{...options,expectedToken:req.body.token}):await planFile(db,file,options.factoryCode));
 }catch(error){
  if(error.status)return res.status(error.status).json({error:error.message});
  res.status(400).json({error:'导入包读取失败，请核对文件格式后重试'});
 }finally{if(req.file)await fs.promises.unlink(req.file.path).catch(()=>{});}
});
module.exports=router;
