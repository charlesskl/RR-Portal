const {calculate,matches}=require('../../frontend/jazwares-freight');
function addJazwaresFreightSheet(wb,quote,sales,engineering,refs={}) {
  if(!matches(quote.customer))return;
  const m=calculate(sales.freight_calc?.jazwares,engineering.carton_calc,sales.header);
  const ws=wb.addWorksheet('JAZWARES运费');
  ws.columns=[{width:30},{width:28},{width:28}];
  ws.mergeCells('A1:C1');ws.getCell('A1').value='JAZWARES 浙江 / 广东运费计算';
  [['RMB→HKD 汇率',m.fx],['HKD→USD 汇率',m.usd],['找数除数',m.divisor],['加价倍数',m.markup],['每箱 CBM',m.cbm],['每箱装量 PCS',m.pcs],['3吨车容量 CBM',m.capacity]].forEach((row,i)=>{ws.getCell(i+2,1).value=row[0];ws.getCell(i+2,2).value=row[1];});
  const formula=(address,text,result)=>{ws.getCell(address).value={formula:text,result:result??''};};
  const carton=engineering.carton_calc || {};
  if(refs.cartonCuftCell) {
    formula('B6',`IF('报价明细'!${refs.cartonCuftCell}>0,'报价明细'!${refs.cartonCuftCell}/35.32,"")`,m.cbm);
  } else {
    [['E','纸箱长（英寸）',carton.cl],['F','纸箱宽（英寸）',carton.cw],['G','纸箱高（英寸）',carton.ch],['H','备用 CUFT',carton.cuft]].forEach(([col,label,value])=>{
      ws.getColumn(col).width=20;ws.getCell(col+'1').value=label;ws.getCell(col+'2').value=Number(value)||0;
    });
    formula('B6','IF(AND(E2>0,F2>0,G2>0),E2*F2*G2/1728/35.32,IF(H2>0,H2/35.32,""))',m.cbm);
  }
  if(refs.cartonQtyCell)formula('B7',`'报价明细'!${refs.cartonQtyCell}`,m.pcs);
  ws.getCell('B6').numFmt='0.0000';
  m.regions.forEach((r,i)=>{
    const title=10+i*8,fee=title+1,volume=title+2,qty=title+3,unit=title+4,usd=title+5;
    ws.mergeCells(title,1,title,3);ws.getCell(title,1).value=r.name;
    ws.getCell(fee,1).value='运费 RMB / HKD';ws.getCell(fee,2).value=r.rmb;
    formula(`C${fee}`,`IF($B$2>0,B${fee}/$B$2,"")`,r.hkd);
    ws.getCell(volume,1).value='每箱 / 每个 CBM';formula(`B${volume}`,'IF($B$6>0,$B$6,"")',m.cbm);
    formula(`C${volume}`,`IF(AND(ISNUMBER(B${volume}),$B$7>0),B${volume}/$B$7,"")`,m.unitCbm);
    ws.getCell(qty,1).value='手填 / 理论装载数量 PCS';ws.getCell(qty,2).value=r.quantity;
    formula(`C${qty}`,`IF(AND(ISNUMBER(C${volume}),C${volume}>0),$B$8/C${volume},"")`,m.theoreticalQuantity);
    ws.getCell(unit,1).value='单个运费 HKD';formula(`B${unit}`,`IF(AND(ISNUMBER(C${fee}),B${qty}>0),C${fee}/B${qty},"")`,r.perPiece);
    ws.getCell(usd,1).value='USD 价（含加价 / 不加价）';
    formula(`B${usd}`,`IF(AND(ISNUMBER(B${unit}),$B$4>0,$B$3>0),B${unit}/$B$4*$B$5/$B$3,"")`,r.usdMarkup);
    formula(`C${usd}`,`IF(AND(ISNUMBER(B${unit}),$B$4>0,$B$3>0),B${unit}/$B$4/$B$3,"")`,r.usdPlain);
    for(const col of [2,3])ws.getCell(volume,col).numFmt='0.0000';
  });
  ws.eachRow(row=>{row.height=28;row.eachCell(cell=>{cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};cell.font={name:'Microsoft YaHei',size:11};cell.border=Object.fromEntries(['top','bottom','left','right'].map(k=>[k,{style:'thin'}]));if(!cell.numFmt)cell.numFmt='0.000';});});
  ws.pageSetup={orientation:'portrait',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:1};
}
function appendJazwaresFreightDetails(ws,startRow,quote,sales,engineering,startCol=1,refs={}) {
  if(!matches(quote.customer))return startRow;
  const m=calculate(sales.freight_calc?.jazwares,engineering.carton_calc,sales.header);
  let row=startRow;
  const write=(values,formats=[],highlight=false)=>{
    const ranges=startCol === 1 ? [[1,3],[4,6],[7,9]] : [[startCol,startCol+1],[startCol+2,startCol+2],[startCol+3,startCol+4]];
    ranges.forEach(([first,last],i)=>{
      ws.mergeCells(row,first,row,last);
      const c=ws.getCell(row,first);c.value=values[i]??'';
      c.alignment={horizontal:'center',vertical:'middle',wrapText:true};
      c.font={name:'Microsoft YaHei',size:11,bold:highlight,color:{argb:'FF1F2937'}};
      c.border=Object.fromEntries(['top','bottom','left','right'].map(k=>[k,{style:'thin',color:{argb:'FFCBD5E1'}}]));
      if(highlight)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}};
      if(formats[i])c.numFmt=formats[i];
    });
    ws.getRow(row).height=30;row++;
  };
  const ref=(address,result)=>({formula:`IF(ISNUMBER('JAZWARES运费'!${address}),'JAZWARES运费'!${address},"待补参数")`,result:result??'待补参数'});
  m.regions.forEach((r,i)=>{
    const source=11+i*8;
    write([r.name,'',''],[],true);
    write(['项目','数值','换算 / 参考'],[],true);
    write(['运费',ref(`B${source}`,r.rmb),ref(`C${source}`,r.hkd)],['','"RMB "#,##0.00','"HK$ "#,##0.00']);
    const boxCbm=refs.cartonCuftCell
      ? {formula:`IF(${refs.cartonCuftCell}>0,${refs.cartonCuftCell}/35.32,"待补参数")`,result:m.cbm??'待补参数'}
      : ref(`B${source+1}`,m.cbm);
    const unitCbm=refs.cartonCuftCell && refs.cartonQtyCell
      ? {formula:`IF(AND(${refs.cartonCuftCell}>0,${refs.cartonQtyCell}>0),${refs.cartonCuftCell}/35.32/${refs.cartonQtyCell},"待补参数")`,result:m.unitCbm??'待补参数'}
      : ref(`C${source+1}`,m.unitCbm);
    write(['体积 CBM',boxCbm,unitCbm],['','"每箱 "0.0000','"每个 "0.0000']);
    write([{formula:`"3吨车 / "&TEXT('JAZWARES运费'!B8,"0.##")&" 方"`,result:`3吨车 / ${m.capacity} 方`},ref(`B${source+2}`,r.quantity),ref(`C${source+2}`,m.theoreticalQuantity)],['','"手填 "#,##0" PCS"','"理论 "#,##0" PCS"']);
    write(['单个运费 HKD',ref(`B${source+3}`,r.perPiece),''],['','0.000']);
    write(['USD 价',ref(`B${source+4}`,r.usdMarkup),ref(`C${source+4}`,r.usdPlain)],['','"含加价 "0.000','"不加价 "0.000'],true);
    row++;
  });
  return row;
}
module.exports={addJazwaresFreightSheet,appendJazwaresFreightDetails};
