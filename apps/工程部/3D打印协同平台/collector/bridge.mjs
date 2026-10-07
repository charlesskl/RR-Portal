// Read only the existing local service; never load printer drivers or forward credentials.
export async function readLegacy(config) {
 const offline=Object.fromEntries(Object.values(config.machineMap).map(id=>[String(id),{connected:false,gcodeState:'UNKNOWN',printProgress:0}]));
 try {
  const response=await fetch(new URL('/api/printers',config.url),{headers:{Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64')},signal:AbortSignal.timeout(4000),redirect:'error'});
  if(!response.ok)throw Error();
  const data=await response.json();
  for(const [source,target]of Object.entries(config.machineMap)){
   const value=data?.[source];if(!value||typeof value!=='object')continue;
   const seen=Number(value.lastUpdate||value.lastSeen||0);
   const fresh=Number.isFinite(seen)&&Date.now()-seen>=-5000&&Date.now()-seen<30000;
   offline[String(target)]={connected:value.connected===true&&fresh,gcodeState:fresh&&['IDLE','RUNNING','FINISH','FAILED','PAUSE','ERROR'].includes(value.gcodeState)?value.gcodeState:'UNKNOWN',printProgress:Math.min(100,Math.max(0,Number(value.printProgress)||0))};
  }
  return {statuses:offline,error:''};
 } catch {return {statuses:offline,error:'无法读取原 3d-server，请检查其运行状态、端口和登录凭据'};}
}
