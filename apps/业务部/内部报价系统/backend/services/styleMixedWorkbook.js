'use strict';
const COLORS={navy:'FF173E5B',blue:'FFE4EEF7',line:'FFD6E1EB',text:'FF24374B',stripe:'FFF7FAFD',white:'FFFFFFFF',yellow:'FFFFF3D2'};
const solid=c=>({type:'pattern',pattern:'solid',fgColor:{argb:c}});
const units=text=>[...String(text)].reduce((n,c)=>n+(/[^\x00-\x7f]/.test(c)?2:1),0);
function styleMixedWorkbook(wb,blocks,moves){
 for(const ws of wb.worksheets){
  const main=ws.name==='总报价表';
  ws.properties.defaultRowHeight=25;
  ws.columns.forEach((c,i)=>{c.width=i===0?(main?34:22):i===1?30:i===2?13:i===3||i===4?16:i===5?18:14;});
  const merges=new Map();
  for(const m of ws.model.merges||[]){const [first,last]=m.split(':');const a=ws.getCell(first),b=ws.getCell(last);merges.set(first,{end:b.col,rows:b.row-a.row+1});}
  let sequenceCol=0;
  ws.eachRow({includeEmpty:true},row=>{
   if(!row.hasValues){row.height=10;return;}
   const first=row.getCell(1),label=typeof first.value==='string'?first.value:'';
   const span=merges.get(first.address);
   const section=span&&span.end>=8&&span.rows===1&&!!label&&!/^(合计减税|减税后)/.test(label);
   const header=['货号','小产品货号','序号','项目','参数','含税13%类成本','彩盒/内咭','货价','啤工'].includes(label)||['序号','模号'].includes(row.getCell(3).value);
   if(header){sequenceCol=0;row.eachCell(c=>{if(c.value==='序号')sequenceCol=c.col;});}
   const total=/^(总合计|合计|小产品合计|全部小产品平均价|TOTAL|含运|码点后合计|统一找数|减税后)/.test(label);
   const shared=label==='共有费用';
   let height=section?32:header?38:25;
   row.eachCell({includeEmpty:true},cell=>{
    if(cell.isMerged&&cell.master.address!==cell.address)return;
    const text=typeof cell.value==='string'?cell.value:'';
    const numeric=typeof cell.value==='number'||!!cell.formula;
    cell.font={name:'Microsoft YaHei',size:section?12:10,bold:!!(section||header||total||shared),color:{argb:section?COLORS.white:COLORS.text}};
    cell.fill=solid(section?COLORS.navy:header||total?COLORS.blue:shared?COLORS.yellow:row.number%2?COLORS.white:COLORS.stripe);
    cell.alignment={vertical:'middle',horizontal:section?'left':header?'center':numeric?'right':'left',wrapText:!numeric};
    cell.border={bottom:{style:total?'thin':'hair',color:{argb:COLORS.line}}};
    if(text)cell.numFmt='@';
    else if(numeric&&(!cell.numFmt||cell.numFmt==='General'))cell.numFmt='0.0000';
    if(numeric&&cell.col===sequenceCol&&!header)cell.numFmt='0';
    const merged=merges.get(cell.address);
    if(text&&(!merged||merged.rows===1)){
      let width=0;for(let c=cell.col;c<=(merged?.end||cell.col);c++)width+=ws.getColumn(c).width;
      const lines=text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(units(line)/Math.max(6,width*.9))),0);
      height=Math.max(height,lines*(section?17:14)+10);
    }
   });
   row.height=Math.min(320,height);
  });
  ws.views=(ws.views?.length?ws.views:[{state:'normal'}]).map(v=>({...v,showGridLines:false,zoomScale:90}));
  ws.pageSetup={...ws.pageSetup,orientation:'landscape',paperSize:8,fitToPage:false,scale:75,margins:{left:.3,right:.3,top:.4,bottom:.4,header:.2,footer:.2},printTitlesColumn:'A:B',printArea:`A1:${ws.getColumn(ws.columnCount).letter}${ws.rowCount}`};
  ws.headerFooter={oddFooter:'&L内部报价明细&C&P / &N&R&A'};
 }
 const main=wb.getWorksheet('总报价表');
 // Give the product matrix one title and a quiet explanatory line.
 const classification=moves.get('内部分类汇总');
 if(classification){
  const start=classification.offset;
  const title=main.getCell(start,1);
  title.value='各小产品费用明细及合计（HKD）';
  title.font={name:'Microsoft YaHei',size:14,bold:true,color:{argb:COLORS.white}};
  title.alignment={vertical:'middle',horizontal:'left',indent:1};
  main.getRow(start).height=36;
  // The quote identity already appears in the workbook heading.
  for(const r of [start+1,start+2]){
   main.getCell(r,1).value=null;main.getRow(r).height=4;
   main.getRow(r).eachCell({includeEmpty:true},c=>{c.fill=solid(COLORS.white);c.border={};});
  }
  const note=main.getCell(start+3,1);
  note.value='金额单位：HKD  ｜  分类金额为原始成本；NA后金额＝成本合计×NA比例；共有费用每包装计一次。';
  note.font={name:'Microsoft YaHei',size:10,color:{argb:'FF60758A'}};
  note.fill=solid('FFF0F4F8');note.border={};
  note.alignment={vertical:'middle',horizontal:'left',wrapText:true,indent:1};
  main.getRow(start+3).height=28;
  main.getRow(start+4).height=42;
 }
 // Pricing and tax sections follow the lighter single-product quotation layout.
 const pricing=moves.get('总报价表');
 if(pricing){
  const o=pricing.offset;
  main.getCell(o,1).value='十一、出货价算价';
  for(const r of [o+1,o+2,o+3,o+4]){
    main.getRow(r).eachCell(c=>{if(!c.formula)c.value=null;c.fill=solid(COLORS.white);c.border={};});
    main.getRow(r).height=4;
  }
  const border={style:'thin',color:{argb:'FFB7CAD9'}};
  const paint=(r,start,end,fill,bold=false)=>{
    for(let col=start;col<=end;col++){
      const c=main.getCell(r,col);c.fill=solid(fill);
      c.border={top:border,bottom:border,left:border,right:border};
      c.font={name:'Microsoft YaHei',size:11,bold,color:{argb:COLORS.text}};
      c.alignment={vertical:'middle',horizontal:typeof c.value==='string'?'left':'right',wrapText:true};
    }
    main.getRow(r).height=Math.max(main.getRow(r).height||25,28);
  };
  for(let r=6;r<=25;r++)paint(o+r,1,5,r===6?COLORS.blue:[10,16,17,18,21,25].includes(r)?COLORS.blue:COLORS.white,[6,10,16,17,18,21,22,25].includes(r));
  for(let r=6;r<=14;r++)paint(o+r,7,12,r===6?COLORS.blue:COLORS.white,r===6);
  for(let r=17;r<=19;r++)paint(o+r,7,12,r===17?COLORS.blue:COLORS.white,r===17);
  // A compact heading, a clear selected scheme, and a distinct final quote.
  main.getRow(o).height=34;
  main.getCell(o,1).alignment={vertical:'middle',horizontal:'left',indent:1};
  main.getCell(o+1,1).value='金额按每包装计算  ·  蓝色列为报客方案';
  main.getCell(o+1,1).font={name:'Microsoft YaHei',size:10,color:{argb:'FF60758A'}};
  main.getCell(o+1,1).alignment={vertical:'middle',horizontal:'left',indent:1};
  main.getRow(o+1).height=23;
  for(const r of [o+2,o+3,o+4])main.getRow(r).height=2;
  main.mergeCells(o+5,1,o+5,5);
  main.mergeCells(o+5,7,o+5,12);
  for(const [col,label] of [[1,'报价计算 · HKD / USD'],[7,'运输方案对比 · HKD / 包装']]){
    const c=main.getCell(o+5,col);c.value=label;
    c.font={name:'Microsoft YaHei',size:11,bold:true,color:{argb:COLORS.navy}};
    c.alignment={vertical:'middle',horizontal:'left'};
    c.fill=solid(COLORS.white);c.border={};
  }
  main.getRow(o+5).height=27;
  for(let r=7;r<=25;r++){
    const selected=main.getCell(o+r,4);
    selected.fill=solid('FFEDF5FC');
    selected.border={...selected.border,left:{style:'thin',color:{argb:'FF6397BD'}},right:{style:'thin',color:{argb:'FF6397BD'}}};
    selected.font={...selected.font,bold:true};
    for(let col=1;col<=5;col++){
      const c=main.getCell(o+r,col);
      c.alignment={vertical:'middle',horizontal:col===1?'left':'right',wrapText:col===1};
      if(col>1)c.numFmt='0.0000';
    }
    const param=main.getCell(o+r,2);
    if(param.value!==null){param.fill=solid([10,16,17,18,21,25].includes(r)?COLORS.blue:COLORS.white);param.font={...param.font,bold:true};}
  }
  for(const col of [1,2,3,4,5,7,9,10,11]){
    const c=main.getCell(o+6,col);c.fill=solid(col===4?'FF28638D':COLORS.blue);
    c.font={...c.font,bold:true,color:{argb:col===4?COLORS.white:COLORS.navy}};
    c.alignment={vertical:'middle',horizontal:'center',wrapText:true};
  }
  main.getRow(o+6).height=42;
  for(let r=7;r<=14;r++){
    const selected=main.getCell(o+r,7).value===String(main.getCell(o+6,4).value).split('（')[0].trim();
    for(let col=7;col<=12;col++){
      const c=main.getCell(o+r,col);c.fill=solid(selected?'FFEDF5FC':r%2?COLORS.white:COLORS.stripe);
      c.font={...c.font,bold:selected};
    }
  }
  for(let col=1;col<=5;col++){
    const c=main.getCell(o+25,col);c.fill=solid(col===4?'FF28638D':COLORS.navy);
    c.font={name:'Microsoft YaHei',size:col>=3?14:12,bold:true,color:{argb:COLORS.white}};
    c.border={top:{style:'medium',color:{argb:'FF6397BD'}},bottom:border};
  }
  main.getRow(o+25).height=38;
  // Omit the redundant input-location note without shifting formula addresses.
  main.getRow(o+27).eachCell(c=>{c.value=null;c.fill=solid(COLORS.white);c.border={};});
  main.getRow(o+26).height=4;
  main.getRow(o+27).height=4;
  // Keep the gutter clear instead of extending striped table rows across it.
  for(let r=6;r<=25;r++){const c=main.getCell(o+r,6);c.fill=solid(COLORS.white);c.border={};}
  main.eachRow(row=>{
    if(row.number<=o+27)return;
    const label=row.getCell(1).value;
    if(label==='减税明细 / 成本汇总'||['一、出厂货价核','二、包装 / 外购','三、人工 & 成本汇总','四、减税明细'].includes(label)){
      const cell=row.getCell(1);cell.fill=solid(COLORS.white);
      cell.font={name:'Microsoft YaHei',size:label==='减税明细 / 成本汇总'?13:11,bold:true,color:{argb:COLORS.navy}};
      cell.border={bottom:{style:'thin',color:{argb:'FF4299CB'}}};row.height=30;
    }
  });
 }
 // Keep injection records legible in both the overview and department sheet.
 for(const ws of [main,wb.getWorksheet('啤机明细')].filter(Boolean)){
  const header=ws.getRows(1,ws.rowCount).find(r=>['序号','模号'].includes(r.getCell(3).value)&&r.getCell(4).value==='模具名称');
  if(!header)continue;
  const widths={3:16,4:26,5:12,6:15,7:15,8:16,9:17,10:12,11:17,12:12,13:12,14:16,15:13,16:18};
  for(const [col,width] of Object.entries(widths))ws.getColumn(Number(col)).width=Math.max(ws.getColumn(Number(col)).width||0,width);
  const line={style:'thin',color:{argb:'FFD1DEEA'}};
  header.height=46;
  const integerCols=new Set();
  header.eachCell((cell,col)=>{if(['序号','套数','机型','目标数','周期(秒)','周期(秒）','周期（秒）'].includes(String(cell.value)))integerCols.add(col);});
  let previous='';
  for(let r=header.number;r<=ws.rowCount;r++){
   const row=ws.getRow(r),label=row.getCell(1).value;
   if(r>header.number&&(!row.hasValues||label==='总合计')){
    if(label==='总合计')row.height=32;
    break;
   }
   const firstOfProduct=r>header.number&&label!==previous;
   for(let col=1;col<=16;col++){
    const cell=row.getCell(col);
    cell.font={name:'Microsoft YaHei',size:11,bold:r===header.number||col===1,color:{argb:COLORS.text}};
    cell.border={left:line,right:line,top:firstOfProduct?{style:'thin',color:{argb:'FFAEBFD0'}}:line,bottom:line};
    cell.alignment={vertical:'middle',horizontal:r===header.number||integerCols.has(col)||col===5||col===10?'center':col<=4?'left':'right',wrapText:r===header.number||col<=5};
    if(r>header.number&&col===3&&header.getCell(3).value==='模号'){cell.numFmt='@';cell.alignment.horizontal='center';}
    if(r>header.number&&integerCols.has(col)){const value=Number(cell.formula?cell.result:cell.value);cell.numFmt=Number.isInteger(value)?'#,##0':'0.####';}
    if(r>header.number&&[9,11,16].includes(col))cell.numFmt='0.0000';
   }
   if(r>header.number){
    const name=String(row.getCell(4).value||'');
    row.height=Math.max(32,Math.ceil(units(name)/(ws.getColumn(4).width*.85))*15+12);
    previous=label;
   }
  }
 }
 // Merge only adjacent mold identifiers, keeping every component row in place.
 for(const ws of [main,wb.getWorksheet('啤机明细')].filter(Boolean)){
  const header=ws.getRows(1,ws.rowCount).find(r=>r.getCell(3).value==='模号'&&r.getCell(4).value==='模具名称');
  if(!header)continue;
  let start=0,last='',end=0;
  const flush=()=>{
   if(start&&end>start){ws.mergeCells(start,3,end,3);ws.getCell(start,3).alignment={vertical:'middle',horizontal:'center',wrapText:true};}
  };
  for(let r=header.number+1;r<=ws.rowCount;r++){
   const row=ws.getRow(r);
   if(!row.hasValues||row.getCell(1).value==='总合计'){flush();break;}
   const mold=String(row.getCell(3).value??'');
   if(!mold||mold!==last){flush();start=mold?r:0;last=mold;}
   end=r;
   if(r===ws.rowCount)flush();
  }
 }
 // Merge repeated materials only within the same mold group.
 for(const ws of [main,wb.getWorksheet('啤机明细')].filter(Boolean)){
  const header=ws.getRows(1,ws.rowCount).find(r=>r.getCell(3).value==='模号'&&r.getCell(5).value==='材质');
  if(!header)continue;
  let start=0,end=0,lastMold='',lastMaterial='';
  const flush=()=>{if(start&&end>start){ws.mergeCells(start,5,end,5);ws.getCell(start,5).alignment={vertical:'middle',horizontal:'center',wrapText:true};}};
  for(let r=header.number+1;r<=ws.rowCount;r++){
   const row=ws.getRow(r);
   if(!row.hasValues||row.getCell(1).value==='总合计'){flush();break;}
   const mold=String(row.getCell(3).value??''),material=String(row.getCell(5).value??'');
   if(!mold||!material||mold!==lastMold||material!==lastMaterial){flush();start=mold&&material?r:0;lastMold=mold;lastMaterial=material;}
   end=r;if(r===ws.rowCount)flush();
  }
 }
 // Mold-to-part list: one row per physical part, with no product columns.
 for(const ws of [main,wb.getWorksheet('啤机明细')].filter(Boolean)){
  const header=ws.getRows(1,ws.rowCount).find(r=>r.getCell(1).value==='模号'&&r.getCell(2).value==='零件名称');
  if(!header)continue;
  const detailWidth=header.getCell(15).value==='日费用 HKD'?24:14;
  if(detailWidth===24)for(let col=15;col<=24;col++)ws.getColumn(col).width=Math.max(ws.getColumn(col).width||0,18);
  [18,32,14,16,16,16,18,14,18,12,12,16,14,18].forEach((width,i)=>{ws.getColumn(i+1).width=Math.max(ws.getColumn(i+1).width||0,width);});
  header.height=44;let end=header.number;
  for(let r=header.number;r<=ws.rowCount;r++){
   const row=ws.getRow(r);if(r>header.number&&(!row.hasValues||row.getCell(1).value==='总合计'))break;
   end=r;row.height=r===header.number?44:32;
   for(let col=1;col<=detailWidth;col++){
    const c=row.getCell(col),line={style:'thin',color:{argb:'FFD1DEEA'}};
    c.border={top:line,bottom:line,left:line,right:line};c.font={name:'Microsoft YaHei',size:11,bold:r===header.number,color:{argb:COLORS.text}};
    c.fill=solid(r===header.number?COLORS.blue:r%2?COLORS.white:COLORS.stripe);
    c.alignment={vertical:'middle',horizontal:r===header.number||[1,3,8,10,11,12,13].includes(col)?'center':col===2?'left':'right',wrapText:true};
    if(r>header.number){if([1,2,3,8].includes(col))c.numFmt='@';else if([10,11,12,13].includes(col))c.numFmt=Number.isInteger(Number(c.formula?c.result:c.value))?'#,##0':'0.####';else if([7,9,14].includes(col))c.numFmt='0.0000';}
    if(col>=15){c.numFmt=r===header.number?'@':'0.0000';if(r>header.number&&!c.formula)c.fill=solid('FFFFF3CC');}
   }
  }
  for(const col of [3,1]){
   let start=header.number+1;
   for(let r=start+1;r<=end+1;r++){
    const same=r<=end&&ws.getCell(r,col).value!==null&&ws.getCell(r,col).value===ws.getCell(start,col).value&&ws.getCell(r,1).value===ws.getCell(start,1).value;
    if(same)continue;
    if(r-start>1)ws.mergeCells(start,col,r-1,col);start=r;
   }
  }
 }
 // Compact, fully bordered tax summary matching the single-product template.
 const taxTitle=main.getRows(1,main.rowCount).find(r=>r.getCell(1).value==='减税明细 / 成本汇总');
 if(taxTitle){
  const start=taxTitle.number;
  const line={style:'thin',color:{argb:'FFA9BDC9'}};
  const grid=(r,width,header=false,fill=COLORS.white)=>{
   const row=main.getRow(r);row.height=header?25:26;
   for(let col=1;col<=width;col++){
    const c=row.getCell(col);c.fill=solid(fill);
    c.border={top:line,bottom:line,left:line,right:line};
    c.font={name:'Microsoft YaHei',size:11,bold:header,color:{argb:header?'FF103C5D':'FF333333'}};
    c.alignment={vertical:'middle',horizontal:'center',wrapText:true};
   }
  };
  taxTitle.getCell(1).value='十二、减税明细 / 成本汇总';
  taxTitle.height=28;
  for(let i=1;i<=12;i++){
   const c=taxTitle.getCell(i);c.fill=solid(COLORS.white);c.border={bottom:{style:'medium',color:{argb:'FF4299CB'}}};
  }
  taxTitle.getCell(1).font={name:'Microsoft YaHei',size:14,bold:true,color:{argb:'FF103C5D'}};
  for(const [offset,width] of [[2,12],[6,11],[10,11],[14,10]]){
   const r=start+offset;
   main.getRow(r-1).height=14;
   main.getRow(r).height=23;
   for(let col=1;col<=12;col++){
    const c=main.getCell(r,col);c.fill=solid(COLORS.white);c.border={};
   }
   main.getCell(r,1).font={name:'Microsoft YaHei',size:12,bold:true,color:{argb:'FF111111'}};
   grid(r+1,width,true,'FFD9E5EC');
   grid(r+2,width);
   if(offset===10)main.getRow(r+1).height=36;
   if(offset===14){
    grid(r+3,width);grid(r+4,width);
    main.getCell(r+4,10).fill=solid('FFD9E5EC');
   }
  }
  main.getRow(start+19).height=16;
  for(let r=start+20;r<=start+25;r++){
   grid(r,10,false,'FFE7F0F5');
   main.getCell(r,1).alignment={vertical:'middle',horizontal:'left'};
   main.getCell(r,7).alignment={vertical:'middle',horizontal:'right'};
  }
 }
 const cartonHeader=main.getRows(1,main.rowCount).find(r=>r.getCell(1).value==='运输方案'&&r.getCell(2).value==='每箱箱积 CUFT');
 const boxHeader=main.getRows(1,main.rowCount).find(r=>r.getCell(1).value==='名称'&&r.getCell(2).value==='L (inch)');
 if(boxHeader){
   for(let r=boxHeader.number;r<=boxHeader.number+3;r++){
     main.getRow(r).height=r===boxHeader.number+1?40:30;
     for(let col=1;col<=7;col++){
       const cell=main.getCell(r,col),header=r===boxHeader.number||(r===boxHeader.number+1&&col>=5),line={style:'thin',color:{argb:'FFB7CAD9'}};
       cell.border={top:line,bottom:line,left:line,right:line};cell.fill=solid(header?COLORS.blue:COLORS.white);
       cell.font={name:'Microsoft YaHei',size:11,bold:header,color:{argb:COLORS.text}};
       cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};
     }
   }
 }
 if(cartonHeader){
   for(const r of [cartonHeader.number,cartonHeader.number+1]){
     main.getRow(r).height=r===cartonHeader.number?44:30;
     for(let col=1;col<=11;col++){
       const cell=main.getCell(r,col),line={style:'thin',color:{argb:'FFB7CAD9'}};
       cell.border={top:line,bottom:line,left:line,right:line};
       cell.fill=solid(r===cartonHeader.number?COLORS.blue:COLORS.white);
       cell.font={name:'Microsoft YaHei',size:11,bold:r===cartonHeader.number,color:{argb:COLORS.text}};
       cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};
     }
   }
 }
 // Start major sections on fresh printed pages without hiding any rows.
 for(const block of blocks){const move=moves.get(block.sheet.name);if(move.offset>1)main.getRow(move.offset-1).addPageBreak();}
}
module.exports={styleMixedWorkbook};
