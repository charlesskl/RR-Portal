const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/connection');
const { sign, verify } = require('../lib/jwt');

const router = express.Router();

router.get('/workshops', (_req, res) => {
  const rows = db
    .prepare('SELECT code, display_name, role, description FROM workshops WHERE active = 1 ORDER BY id')
    .all();
  res.json({ workshops: rows });
});

router.post('/login', (req, res) => {
  const { code, password } = req.body || {};
  if (!code || !password) {
    return res.status(400).json({ error: '车间和密码必填' });
  }

  const workshop = db
    .prepare('SELECT * FROM workshops WHERE code = ? AND active = 1')
    .get(code);

  const logInsert = db.prepare(`
    INSERT INTO login_logs (workshop_id, workshop_code, ip, user_agent, success)
    VALUES (?, ?, ?, ?, ?)
  `);

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';

  if (!workshop) {
    logInsert.run(null, code, ip, ua, 0);
    return res.status(401).json({ error: '车间不存在或已停用' });
  }

  const ok = bcrypt.compareSync(password, workshop.password_hash);
  logInsert.run(workshop.id, workshop.code, ip, ua, ok ? 1 : 0);
  if (!ok) return res.status(401).json({ error: '密码错误' });

  const token = sign({
    sub: workshop.id,
    code: workshop.code,
    role: workshop.role,
    display_name: workshop.display_name,
  });

  res.json({
    token,
    workshop: {
      code: workshop.code,
      display_name: workshop.display_name,
      role: workshop.role,
      entry_path: workshop.entry_path,
    },
  });
});

router.get('/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = verify(token);
    const workshop = db
      .prepare('SELECT code, display_name, role, entry_path FROM workshops WHERE id = ? AND active = 1')
      .get(payload.sub);
    if (!workshop) return res.status(401).json({ error: '账号已失效' });
    res.json({ workshop });
  } catch (e) {
    res.status(401).json({ error: 'token 无效或已过期' });
  }
});

module.exports = router;
