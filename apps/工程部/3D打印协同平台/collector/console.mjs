import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
export function startConsole({port,status,bind,pause}){
 const csrf=randomBytes(24).toString('hex');
 const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");res.setHeader('X-Content-Type-Options','nosniff');
  try{
   if(!['127.0.0.1','localhost'].includes(new URL('http://'+req.headers.host).hostname))return send(res,403,{error:'仅允许本机访问'});
   const route=new URL(req.url,'http://localhost').pathname;
   if(req.method==='GET'&&['/','/console.js','/console.css'].includes(route)){res.setHeader('Content-Type',route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(readFileSync(new URL(route==='/'?'./console.html':'.'+route,import.meta.url)));return;}
   if(req.method==='GET'&&route==='/api/status')return send(res,200,{...status(),csrf});
   if(req.method!=='POST')return send(res,404,{error:'接口不存在'});
   if(req.headers['x-csrf-token']!==csrf||!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'请从本机控制台操作'});
   let raw='';for await(const c of req){raw+=c;if(raw.length>4096)return send(res,413,{error:'请求过大'});}const data=JSON.parse(raw);
   if(route==='/api/bind')bind(data);
   else if(route==='/api/pause')pause(data.paused);
   else return send(res,404,{error:'接口不存在'});
   send(res,200,{ok:true});
  }catch(e){send(res,400,{error:e.message});}
 });server.listen(port,'127.0.0.1',()=>console.log(`现场采集控制台：http://127.0.0.1:${server.address().port}`));return server;
}
