const express = require('express');
const router = express.Router();

router.get('/', (req, res) => res.json([{ id: 1, username: 'admin' }]));

module.exports = router;
