'use strict';
// Remove ownership, not shared/imported part definitions.
function removeMixedProducts(payload, ids) {
  const next = structuredClone(payload), removed = new Set(ids);
  for (const id of removed) {
    delete next.mixed_products?.[id];
    delete next.mixed_pricing?.[id];
    delete next.mixed_part_selections?.[id];
    delete next.parts_catalog?.selections?.[id];
  }
  if (Array.isArray(next.mixed_molds)) next.mixed_molds = next.mixed_molds
    .map(m => ({...m, parts:(m.parts || []).filter(p => !removed.has(p.product_id))}))
    .filter(m => m.parts.length);
  return next;
}
module.exports = { removeMixedProducts };
