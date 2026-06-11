const express = require('express');
const router = express.Router();

// 默认密码（可用环境变量覆盖）— 内网生产系统简单口令，不强求 JWT
const PASSWORDS = {
  A: process.env.WS_A_PASS || 'yao1234',
  B: process.env.WS_B_PASS || 'zhutou',
  C: process.env.WS_C_PASS || 'huadeng',
};

const LABELS = { A: 'A车间(兴信A)', B: 'B车间(兴信B)', C: '华登' };

// 简单 token：base64(workshop:timestamp)，前端用作登录态标记
function makeToken(workshop) {
  return Buffer.from(`${workshop}:${Date.now()}`).toString('base64');
}
function parseToken(token) {
  try {
    const [ws, ts] = Buffer.from(token, 'base64').toString().split(':');
    return { workshop: ws, timestamp: Number(ts) };
  } catch (e) { return null; }
}

// 登录：{ workshop, password } → { token, workshop, label }
router.post('/login', (req, res) => {
  const { workshop, password } = req.body || {};
  if (!workshop || !PASSWORDS[workshop]) {
    return res.status(400).json({ message: '车间不存在' });
  }
  if (password !== PASSWORDS[workshop]) {
    return res.status(401).json({ message: '密码错误' });
  }
  res.json({
    token: makeToken(workshop),
    workshop,
    label: LABELS[workshop],
  });
});

// 校验 token 是否有效
router.get('/verify', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const parsed = parseToken(token);
  if (!parsed || !PASSWORDS[parsed.workshop]) {
    return res.status(401).json({ message: 'token 无效' });
  }
  res.json({ ok: true, workshop: parsed.workshop });
});

// 修改密码：{ workshop, old_password, new_password }
router.post('/change-password', (req, res) => {
  const { workshop, old_password, new_password } = req.body || {};
  if (!workshop || !PASSWORDS[workshop]) {
    return res.status(400).json({ message: '车间不存在' });
  }
  if (old_password !== PASSWORDS[workshop]) {
    return res.status(401).json({ message: '原密码错误' });
  }
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ message: '新密码至少 4 位' });
  }
  PASSWORDS[workshop] = new_password;
  res.json({ ok: true, message: '密码已修改（重启后会重置为默认，请配置环境变量持久化）' });
});

module.exports = router;
