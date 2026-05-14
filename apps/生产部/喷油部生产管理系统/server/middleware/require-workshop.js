function requireWorkshop(req, res, next) {
  const id = Number(req.query.workshop_id);
  if (!id) return res.status(400).json({ error: 'workshop_id required' });
  req.workshopId = id;
  next();
}
module.exports = { requireWorkshop };
