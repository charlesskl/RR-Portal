// The cutover and ledger live outside imported business snapshots.
exports.init=function(store,now=Date.now()){
 store.exec('CREATE TABLE IF NOT EXISTS source_inventory_config (id INTEGER PRIMARY KEY, since INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS source_inventory_ledger (item TEXT PRIMARY KEY, material TEXT NOT NULL, grams REAL NOT NULL, chargedAt TEXT NOT NULL)');
 store.prepare('INSERT OR IGNORE INTO source_inventory_config VALUES (1,?)').run(now);
};
exports.apply=function(store,data){
 const config=store.prepare('SELECT since FROM source_inventory_config WHERE id=1').get();
 if(!config)return;
 for(const day of Object.values(data.records||{}))for(const item of day.items||[]){
  if(!item.sourceRecordId||item._deleted)continue;
  const charged=store.prepare('SELECT * FROM source_inventory_ledger WHERE item=?').get(item._id);
  if(charged&&!item.qualitySettled){item.inventoryReview=false;item.inventoryDeduction=charged;item.inventoryReason='';continue;}
  if(item.qualitySettled||!item.inventoryReview)continue;
  const start=Date.parse(item.printStartTime);
  if(!Number.isFinite(start)||start<config.since){item.inventoryReason='历史记录，请核对原库存，未自动补扣';continue;}
  const grams=Number(item.weight)*Number(item.qty),stock=data.inventory?.[item.material];
  if(!item.autoRecord||!item.material||!Number.isFinite(grams)||Number(item.weight)<=0||Number(item.qty)<=0){item.inventoryReason='材料、料重或数量不完整，请核对';continue;}
  if(!stock||!Number.isFinite(stock.stockG)||stock.stockG<grams){item.inventoryReason='材料库存不足或不存在，请核实入库';continue;}
  const chargedAt=new Date().toISOString();
  store.prepare('INSERT INTO source_inventory_ledger VALUES (?,?,?,?)').run(item._id,item.material,grams,chargedAt);
  stock.stockG-=grams;stock._updatedAt=Date.now();data._snapshotUpdatedAt=Date.now();
  item.inventoryReview=false;item.inventoryReason='';item.inventoryDeduction={material:item.material,grams,chargedAt};item._updatedAt=Date.now();
 }
};
