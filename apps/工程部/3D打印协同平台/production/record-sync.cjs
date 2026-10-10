const {createHash}=require('node:crypto');
module.exports=function mergeRecords(store,data,station,rows){
 store.exec('CREATE TABLE IF NOT EXISTS source_records (source TEXT PRIMARY KEY, item TEXT NOT NULL)');
 data.records||={};let added=0,updated=0;
 const all=()=>Object.values(data.records).flatMap(d=>d.items||[]);
 for(const row of rows){
  const key=station+':'+row.sourceId,known=store.prepare('SELECT item FROM source_records WHERE source=?').get(key);
  let item=known?all().find(i=>i._id===known.item):all().find(i=>i.sourceStation===station&&i.sourceRecordId===row.sourceId)||all().find(i=>i._id===row.sourceId&&!i.cloudJobId&&String(i.machine)===row.sourceMachine);
  // Deleted cloud rows must never reappear on retries or Windows restarts.
  if(known&&!item)continue;
  if(!item&&row.jobId)item=all().find(i=>i.cloudJobId===row.jobId&&(i.cloudAttempt||1)===(row.attempt||1)&&!i.sourceRecordId);
  if(!item){
   const id='bridge-'+createHash('sha256').update(key).digest('hex');
   item={...row.record,_id:id,machine:Number(row.sourceMachine),platformMachine:Number(row.machine),sourceStation:station,sourceRecordId:row.sourceId,_updatedAt:Date.now(),_mergedAt:Date.now(),inventoryReview:true};
   if(row.jobId){item.cloudJobId=row.jobId;item.cloudAttempt=row.attempt||1;}
   data.records[row.date]||={off:false,items:[]};data.records[row.date].items.push(item);added++;
  }else if(!item._deleted){
   // Cloud business edits win; only update printer timestamps and an unedited duration.
   const prev=item._sourceFacts||{};
   for(const field of ['printStartTime','printEndTime'])if(row.record[field]&&!item[field]){item[field]=row.record[field];updated++;}
   if(known&&!item.cloudJobId&&item.time===prev.time&&row.record.time!==undefined&&item.time!==row.record.time){item.time=row.record.time;updated++;}
   if(row.jobId&&!item.cloudJobId){item.cloudJobId=row.jobId;item.cloudAttempt=row.attempt||1;}
   item._updatedAt=Date.now();item._mergedAt=Date.now();
  }
  if(row.record.autoRecord)item.printerOutcome=row.record.printEndTime?(row.record.remark?.includes('失败')?'失败':'已结束'):'进行中';
  item.sourceRecordId||=row.sourceId;item.sourceStation||=station;
  item._sourceFacts={time:row.record.time};
  store.prepare('INSERT OR IGNORE INTO source_records VALUES (?,?)').run(key,item._id);
 }
 return {added,updated};
};
