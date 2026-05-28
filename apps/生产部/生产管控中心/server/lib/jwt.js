const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'production-control-dev-secret-change-in-prod';
const EXPIRES = process.env.JWT_EXPIRES || '8h';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

function verify(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { sign, verify };
