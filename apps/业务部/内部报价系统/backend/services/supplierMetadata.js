'use strict';

// Supplier names are identities. Keep word boundaries ("A B" and "AB" may
// name different companies) while tolerating case and presentation whitespace.
const supplierNameKey = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim();
  if (typeof value === 'object' && value.text != null) return String(value.text).trim();
  if (typeof value === 'object' && value.result != null) return String(value.result).trim();
  return String(value).trim();
}

const supplierLabel = /^(?:供应商(?:名称|名)?|供應商(?:名稱|名)?|SUPPLIER(?:\s*NAME)?)(?:\s*[:：]\s*(.*))?\s*$/i;
// An empty supplier field must not consume a following customer/contact field,
// including templates whose field captions omit their trailing colon.
const otherField = /^(?:公司(?:名称|名稱)?|客户(?:名称|名稱)?|客戶(?:名称|名稱)?|买方|買方|买家|買家|卖方|賣方|报价(?:单号|單號|日期)?|報價(?:单号|單號|日期)?|日期|联系人|聯繫人|联系(?:电话|地址)|聯繫(?:電話|地址)|电话|電話|传真|傳真|地址|邮箱|郵箱|电邮|電郵|币种|幣種|税率|稅率|COMPANY(?:\s*NAME)?|BUYER(?:\s*NAME)?|CUSTOMER(?:\s*NAME)?|CONTACT(?:\s*PERSON)?|PHONE|TEL\.?|FAX|E-?MAIL|ADDRESS|DATE|QUOT(?:E|ATION)(?:\s*(?:NO\.?|NUMBER|DATE))?|CURRENCY|VAT|ATTN\.?|REFERENCE|PAYMENT\s*TERMS|DELIVERY)(?:\s*[:：].*)?$/i;

function supplierMetadata(rows, { joinFragments = false } = {}) {
  const names = new Map();
  for (const row of rows) {
    for (let index = 0; index < row.length; index++) {
      const text = cellText(row[index]);
      const match = text.match(supplierLabel);
      if (!match) continue;
      // A PDF text run can split both the caption and the company name into
      // separate items. Excel cells remain separate fields and do not join.
      let valueStart = index + 1;
      let name = (match[1] || '').trim();
      if (joinFragments && /^SUPPLIER$/i.test(text)) {
        const nameCaption = cellText(row[valueStart]).match(/^NAME(?:\s*[:：]\s*(.*))?\s*$/i);
        if (nameCaption) {
          name = (nameCaption[1] || '').trim();
          valueStart++;
        }
      }
      if (!name || joinFragments) {
        const fragments = name ? [name] : [];
        for (let next = valueStart; next < row.length; next++) {
          const candidate = cellText(row[next]);
          if (!candidate || candidate === text) continue; // merged label cells
          if (/[:：]$/.test(candidate) || otherField.test(candidate) || supplierLabel.test(candidate)) break;
          fragments.push(candidate);
          if (!joinFragments) break;
        }
        name = fragments.join(' ');
      }
      if (name && name.length <= 100) names.set(supplierNameKey(name), name);
    }
  }
  const supplier_names = [...names.values()];
  return { supplier_names, supplier_name: supplier_names.length === 1 ? supplier_names[0] : '' };
}

module.exports = { supplierMetadata, supplierNameKey };
