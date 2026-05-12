const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM lines WHERE workshop_id=? ORDER BY sort_order')
    .all(req.workshopId));
});

module.exports = router;
