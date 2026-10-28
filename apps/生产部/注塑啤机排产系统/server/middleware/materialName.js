// Display metadata is accepted only at the HTTP boundary. It is never parsed
// into mold/source identity or inferred from a mold code.
module.exports = function validateMaterialName(req, res, next) {
  const rows = Array.isArray(req.body?.orders) ? req.body.orders : [req.body];
  if (rows.some(row => row?.material_name != null &&
    (typeof row.material_name !== 'string' || row.material_name.length > 4000))) {
    return res.status(400).json({ message: '物料名称必须为4000字以内的文字或留空' });
  }
  next();
};
