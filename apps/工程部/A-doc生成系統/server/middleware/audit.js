const fs = require('fs');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '..', 'data', 'audit.log');

function auditLog(action, userId, details) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    action,
    userId,
    details,
  });
  try {
    fs.appendFileSync(AUDIT_FILE, line + '\n', 'utf8');
  } catch (err) {
    console.error('审计日志写入失败:', err.message);
  }
}

module.exports = { auditLog };
