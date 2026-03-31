const { query } = require('../db/postgres');

async function logAction(userId, userName, action, tableName, recordId, oldValue, newValue) {
  await query(
    `INSERT INTO audit_logs (user_id, user_name, action, table_name, record_id, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)`,
    [userId, userName, action, tableName, recordId,
     oldValue ? JSON.stringify(oldValue) : null,
     newValue ? JSON.stringify(newValue) : null]
  );
}

module.exports = { logAction };
