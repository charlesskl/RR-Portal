"""Pure closed-snapshot PR942 template transition proof. Never opens a live database or application."""
import calendar,contextlib,datetime,re,sqlite3
def need(v):
 if not v:raise RuntimeError('VOYAGEPLEX_942_TEMPLATE_TRANSITION_REJECTED')
def quote(v):return'"'+v.replace('"','""')+'"'
def utc_ns(value):
 need(type(value)is str);m=re.fullmatch(r'(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)?',value);need(m is not None)
 d=datetime.datetime.fromisoformat(m[1]+'T'+m[2]+(m[4].replace('Z','+00:00')if m[4]else'+00:00'));return calendar.timegm(d.astimezone(datetime.timezone.utc).utctimetuple())*10**9+int((m[3]or'').ljust(9,'0'))
def expected_table(old):
 schema=old.execute("SELECT sql FROM sqlite_master WHERE type='table'AND name='ExportTemplates'").fetchall();need(len(schema)==1 and schema[0][0]);sim=sqlite3.connect(':memory:');sim.execute(schema[0][0]);columns=[c[1]for c in old.execute('PRAGMA table_xinfo(ExportTemplates)')];need({'Id','Company','Name','ShipmentMode','Purpose','Version','Notes','IsEnabled','IsDefault','UpdatedAt'}<=set(columns))
 original=list(old.execute('SELECT '+','.join(map(quote,columns))+' FROM ExportTemplates ORDER BY Id'));need(len(original)<=100000);sim.executemany('INSERT INTO ExportTemplates('+','.join(map(quote,columns))+')VALUES('+','.join('?'for _ in columns)+')',original)
 sequence=old.execute("SELECT seq FROM sqlite_sequence WHERE name='ExportTemplates'").fetchall();need(len(sequence)<=1 and(not sequence or type(sequence[0][0])is int and sequence[0][0]>=0));sim.execute("DELETE FROM sqlite_sequence WHERE name='ExportTemplates'")
 if sequence:sim.execute("INSERT INTO sqlite_sequence(name,seq)VALUES('ExportTemplates',?)",sequence[0])
 for name,declaration in(('WeightRule',"TEXT NOT NULL DEFAULT 'Template'"),('LayoutKey',"TEXT NOT NULL DEFAULT 'Standard'")):
  if name not in columns:sim.execute('ALTER TABLE ExportTemplates ADD COLUMN '+name+' '+declaration)
 return sim,{row[columns.index('Id')]for row in original}
def migrate(sim):
 # This sentinel is only in an in-memory predicted database, never in either input snapshot.
 inserted='PR942_EXPECTED_INSERT_TIMESTAMP';insert='INSERT INTO ExportTemplates(Company,Name,ShipmentMode,Purpose,Version,Notes,WeightRule,LayoutKey,IsEnabled,IsDefault,UpdatedAt)SELECT ?,?,?,?,?,?,?,?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM ExportTemplates WHERE '
 for company in('Xingxin','Huadeng'):
  for mode in('Container','Warehouse'):
   for purpose in('Shipping','Warehouse'):
    name=('华登'if company=='Huadeng'else'兴信')+('柜'if mode=='Container'else'车（交仓）')+('船务'if purpose=='Shipping'else'仓务')+'表';sim.execute(insert+'Company=?AND ShipmentMode=?AND Purpose=?)',(company,name,mode,purpose,'1.0','','Template','Standard',1,inserted,company,mode,purpose))
 sim.execute("""UPDATE ExportTemplates SET WeightRule='DisplayInteger',Version='2.0',Name='华登普通'||CASE WHEN ShipmentMode='Container'THEN'做柜'ELSE'交仓'END||CASE WHEN Purpose='Shipping'THEN'船务表'ELSE'仓务表'END,Notes='RR版式；件数×每箱重量，显示整数、保留底层小数；红字品牌。' WHERE Company='Huadeng'AND IsEnabled=1 AND IsDefault=1 AND LayoutKey='Standard'AND WeightRule='Template'AND Version='1.0'AND Notes=''AND Name IN('华登柜船务表','华登柜仓务表','华登车（交仓）船务表','华登车（交仓）仓务表')""")
 for mode in('Container','Warehouse'):
  for purpose in('Shipping','Warehouse'):
   for layout,rule,label in(('Standard','Truncate','INT取整版'),('CustomerItem','DisplayInteger','客户ITEM版'),('CartonMarks','DisplayInteger','箱唛尺寸版')):
    if layout=='CartonMarks'and mode!='Warehouse':continue
    name='华登'+('做柜'if mode=='Container'else'交仓')+('船务'if purpose=='Shipping'else'仓务')+'表 · '+label;sim.execute(insert+"Company='Huadeng'AND ShipmentMode=?AND Purpose=?AND LayoutKey=?AND WeightRule=?)",('Huadeng',name,mode,purpose,'2.0','导出前人工核对版式与公式版本。',rule,layout,0,inserted,mode,purpose,layout,rule))
 for purpose in('Shipping','Warehouse'):sim.execute(insert+"Company='Huadeng'AND LayoutKey='SkyCastle'AND Purpose=?)",('Huadeng','华登多柜特殊表','Container',purpose,'1.0','','Template','SkyCastle',0,inserted,purpose))
 return inserted
def prove(old,new,cell,lower,upper):
 low,high=utc_ns(lower),utc_ns(upper);need(low<=high)
 with contextlib.closing(expected_table(old)[0])as sim:
  old_ids={v[0]for v in old.execute('SELECT Id FROM ExportTemplates')};sentinel=migrate(sim);columns=sim.execute('PRAGMA table_xinfo(ExportTemplates)').fetchall();need(columns==new.execute('PRAGMA table_xinfo(ExportTemplates)').fetchall());names=[r[1]for r in columns];q=','.join(map(quote,names));expected=sim.execute('SELECT '+q+' FROM ExportTemplates ORDER BY Id').fetchall();actual=new.execute('SELECT '+q+' FROM ExportTemplates ORDER BY Id').fetchall();need(len(expected)==len(actual));timeindex=names.index('UpdatedAt');idindex=names.index('Id');inserted=0;oldrows=0
  for wanted,observed in zip(expected,actual):
   need(type(observed[idindex])is int and observed[idindex]==wanted[idindex]);copy=list(observed)
   if wanted[idindex]not in old_ids:need(wanted[timeindex]==sentinel and low<=utc_ns(observed[timeindex])<=high);copy[timeindex]=sentinel;inserted+=1
   else:oldrows+=1
   need([cell(v)for v in wanted]==[cell(v)for v in copy])
  predicted=sim.execute("SELECT sql FROM sqlite_master WHERE type='table'AND name='ExportTemplates'").fetchone()[0];actualsql=new.execute("SELECT sql FROM sqlite_master WHERE type='table'AND name='ExportTemplates'").fetchone()[0];need(predicted==actualsql)
  sequence=sim.execute("SELECT seq FROM sqlite_sequence WHERE name='ExportTemplates'").fetchall();need(sequence==new.execute("SELECT seq FROM sqlite_sequence WHERE name='ExportTemplates'").fetchall())
 return {'exactSchemaAndAllTemplateRowsPassed':True,'originalTemplateIdsPreservedAndOnlyExactLegacyFieldsChanged':True,'oldTemplateRows':oldrows,'exactMissingPresetRowsAdded':inserted,'newTemplateRows':len(actual),'insertedTimestampsInsideNewAPIStartAndSnapshotWindow':True,'originalUpdatedAtPreserved':True,'doesNotIdentifyConcurrentActor':True}
