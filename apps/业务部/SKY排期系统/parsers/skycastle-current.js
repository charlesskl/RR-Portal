const { endsWithJazwaresCustomer, packagingFromNotes, skyCastleUSPackage } = require('./jazwares-packaging');
// The current Sky Castle form prints one SKU block followed by a quantity,
// unit price and USD amount. Service blocks can carry the placeholder SKU zzOther.
const {itemsWithFeeRemarks} = require('./sky-fees');
const money = value => Number(value.replaceAll(',', ''));
const cents = value => Math.round(value * 100);
function field(text, label) {
  return text.match(new RegExp('^' + label + ':[ \\t]*(.+)$','mi'))?.[1].trim() || '';
}
function date(value) {
  if (!/^[A-Za-z]{3,9} \d{1,2}, \d{4}$/.test(value)) throw Error('请核对 PO 日期');
  const day = new Date(value+' 00:00:00 GMT');
  if (!Number.isFinite(day.getTime())) throw Error('无法识别 PO 日期');
  return day.toISOString().slice(0,10);
}
function detect(text) {
  return /skycastletoys\.com/i.test(text) && /Product\s*\/\s*Service\s+Customer\s+Quantity\s+Price\s+Total/i.test(text);
}
function parse(text, filename) {
  const result = {filename,client:'Sky Castle',items:[],fees:[],poNumber:'',layout:'current'};
  try {
    result.poNumber = field(text,'No\\.'); result.customerPO = field(text,'Customer Purchase Order');
    result.creationDate = date(field(text,'Created')); result.shippingDate = date(field(text,'Delivery date'));
    if (!/^PO\d+(?:-(?:\d+|RR))?$/.test(result.poNumber) || field(text,'Status') !== 'Active') throw Error('请核对 PO 编号及有效状态');
    const heading = /^[ \t]*Product\s*\/\s*Service\s+Customer\s+Quantity\s+Price\s+Total[ \t]*\r?$/gmi;
    const first = heading.exec(text);
    if (!first) throw Error('缺少 PO 明细表头');
    const body = text.slice(heading.lastIndex).split(/^[ \t]*Total units:/mi)[0]
      .replace(heading, '')
      .split('\n').filter(line => {
        const footer = /^Page \d+\/\d+\s+(\S+)$/.exec(line.trim());
        return !(footer && footer[1] === result.poNumber) && !/^-- \d+ of \d+ --$/.test(line.trim());
      }).join('\n');
    result.notes = text.split(/\bNOTES\b/i)[1]?.split(/BILL TO/i)[0]?.trim() || '';
    result.packaging = result.notes.match(/Packaging Version:\s*([^\n]+)/i)?.[1] || result.notes.match(/\(1\)\s*([^\n]*PACKAGING)/i)?.[1] || skyCastleUSPackage(result.notes);
    const shipTo=text.match(/(?:^|\n)SHIP TO\s*\n([\s\S]*?)\nProduct\s*\//i)?.[1] || '';
    result.shipTo=shipTo;result.customerName=shipTo.split('\n')[0].replace(/\s*\[[^\]]+\].*$/,'').trim();
    const country=shipTo.trim().split('\n').filter(line => !/^[+()\d .-]+$/.test(line.trim())).pop();
    const totals=/(?:^|[ \t])(\d[\d,]*)[ \t]+([\d,]+\.\d+)[ \t]+([\d,]+\.\d{2})[ \t]*$/gm;
    let cursor=0;
    for(const match of body.matchAll(totals)){
      const block=body.slice(cursor,match.index).trim();cursor=match.index+match[0].length;
      const [quantity,unitPrice,amount]=match.slice(1).map(money);
      if(cents(quantity*unitPrice)!==cents(amount))throw Error('明细数量与金额不符');
      const skus=[...block.matchAll(/(?:^|\n)SKU:\s*([\w-]+)/gi)];
      const description = block.split(/(?:^|\n)SKU:/i)[0].trim();
      const service = skus.length === 0 || (skus.length === 1 && /^zzOther$/i.test(skus[0][1]));
      if (service) {
        const label = description.replace(/^Other\s+/i, '').split('\n')[0].trim();
        const fee = {description:label, quantity, unitPrice, amount};
        const upc = /^UPC Label Charge\s*\((\d{8,14})\)$/i.exec(label);
        const manual = /^customize collector manual\s*-\s*([\w-]+(?:\s*,\s*[\w-]+)*)$/i.exec(label);
        if (/^Importer Label Cost$/i.test(label)) fee.kind = 'importerLabel';
        else if (upc) Object.assign(fee, {kind:'upcLabel', upc:upc[1]});
        else if (manual) Object.assign(fee, {kind:'manual', codes:manual[1].split(/\s*,\s*/)});
        else if (/^Tape cost$/i.test(label)) fee.kind = 'tape';
        else if (/^Rework Cost\b/i.test(label)) fee.description = label.match(/^Rework Cost(?:[ \t]*\([^)]*\))?/i)[0];
        else throw Error('存在未识别的商品或费用行');
        result.fees.push(fee);
      } else if (skus.length === 1) {
        // After the SKU and its metadata, the customer cell is the last field before quantity.
        const afterSku = block.slice(skus[0].index + skus[0][0].length);
        const customerPackaging = endsWithJazwaresCustomer(afterSku) ? packagingFromNotes(result.notes) : undefined;
        const upcs = [...afterSku.matchAll(/\bUPC\s*[#:]?\s*(\d{8,14})\b/gi)].map(hit => hit[1]);
        if (customerPackaging && shipTo.trim() === country) result.customerName = 'Jazwares, LLC';
        result.items.push({upcs,customerPackaging,partNo:skus[0][1],description:block.split(/\nSKU:/i)[0].trim(),quantity,unitPrice,amount,country:country==='United States'?'美国':country,dueDate:result.shippingDate,remark:result.notes.match(/^Qty from[^\n]*/mi)?.[0] || ''});
      } else throw Error('存在未识别的商品或费用行');
    }
    if (body.slice(cursor).trim()) throw Error('存在未识别的商品或费用行');
    const all=[...result.items,...result.fees];
    const units=text.match(/Total units:\s*([\d,]+)/i);
    const total=text.match(/(?:^|\n)Total \(USD\):\s*\$([\d,.]+)/i);
    if(!result.items.length || !units || !total || all.reduce((s,x)=>s+x.quantity,0)!==money(units[1]) || all.reduce((s,x)=>s+cents(x.amount),0)!==cents(money(total[1])))throw Error('PO 总数或总金额无法与明细核对');
    result.items = itemsWithFeeRemarks(result.items, result.fees);
  } catch(err){result.error=err.message;result.items=[];result.fees=[];}
  return result;
}
module.exports={detect,parse};
