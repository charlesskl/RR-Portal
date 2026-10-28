(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SewingTax = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  function isSpin(customer) {
    return /^(SPIN|SPINMASTER|SPINMASTER-毛绒\(印尼\))$/.test(String(customer || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase());
  }
  function craftFor(row = {}) {
    const explicit = String(row.craft || '').trim();
    if (['电绣', '裁床', '车缝', '手工'].includes(explicit)) return explicit;
    const text = [row.craft, row.fabric, row.material, row.name, row.part].filter(Boolean).join(' ').normalize('NFKC');
    if (/电绣|電繡|绣花|繡花|embroider/i.test(text)) return '电绣';
    if (/裁床/.test(text)) return '裁床';
    if (/车缝|車縫/.test(text)) return '车缝';
    if (/手工/.test(text)) return '手工';
    return '';
  }
  function taxed(value, fallback = true) {
    const label = String(value?.tax_label || value?.price_type || '').trim();
    if (/不含税|未税|免税|UNTAXED|TAX.?FREE/i.test(label)) return false;
    if (/含税|TAXED/i.test(label)) return true;
    if (value?.tax_pct != null && value.tax_pct !== '') return number(value.tax_pct) > 0;
    return fallback;
  }
  function hasSetting(payload = {}, customer) {
    return (isSpin(customer) && (payload.sewing_groups || []).some(group => number(group.labor_amount) || (group.items || []).some(craftFor))) || [payload, ...(payload.sewing_groups || [])].some(value =>
      Boolean(value.tax_label || value.price_type) || (value.tax_pct != null && value.tax_pct !== ''));
  }
  function fractions(payload = {}, customer) {
    const baseTaxed = taxed(payload);
    const spin = isSpin(customer);
    const totals = { sewing_hair: 0, sewing_cloth: 0 };
    const eligible = { ...totals };
    for (const group of payload.sewing_groups || []) {
      const key = group.category === '车发' ? 'sewing_hair' : 'sewing_cloth';
      const qty = group.product_qty == null || group.product_qty === '' ? 1 : Math.max(number(group.product_qty), 0);
      const items = group.items || [];
      const amount = item => number(item.usage) * number(item.mat_price) * (number(item.markup) || 1);
      const embeddedLabor = items.filter(item => /人工/.test(String(item.fabric || item.part || item.name || ''))).reduce((sum, item) => sum + amount(item), 0);
      const cost = (items.reduce((sum, item) => sum + amount(item), 0) + (embeddedLabor > 0 ? 0 : number(group.labor_amount))) * qty;
      totals[key] += cost;
      if (taxed(group, baseTaxed)) {
        // SPIN process labor stays in cost, but only materials enter the refund base.
        eligible[key] += spin ? items.filter(item => !craftFor(item) && !/人工/.test(String(item.fabric || item.part || item.name || '')))
          .reduce((sum, item) => sum + amount(item), 0) * qty : cost;
      }
    }
    return Object.fromEntries(Object.keys(totals).map(key => [key,
      totals[key] > 0 ? eligible[key] / totals[key] : (baseTaxed ? 1 : 0)]));
  }
  function taxableAmounts(payload, components, customer) {
    const shares = fractions(payload, customer);
    return Object.fromEntries(Object.keys(shares).map(key => [key, number(components?.[key]) * shares[key]]));
  }
  return { taxed, hasSetting, fractions, taxableAmounts, isSpin, craftFor };
});
