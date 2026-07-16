'use strict';

function changeUserFactory(db, userId, nextFactoryCode) {
  const current = db.prepare('SELECT factory_code FROM users WHERE id = ?').get(userId);
  if (!current) return null;
  if (current.factory_code === nextFactoryCode) {
    return { changed: false, clearedCustomers: 0 };
  }

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET factory_code = ? WHERE id = ?').run(nextFactoryCode, userId);
    const clearedCustomers = db.prepare('DELETE FROM user_customers WHERE user_id = ?').run(userId).changes;
    db.exec('COMMIT');
    return { changed: true, clearedCustomers };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { changeUserFactory };
