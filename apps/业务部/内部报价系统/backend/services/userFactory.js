'use strict';

function factoryCodesForUser(db, userId, fallbackFactoryCode) {
  const codes = db.prepare('SELECT factory_code FROM user_factories WHERE user_id = ? ORDER BY factory_code')
    .all(userId).map(row => row.factory_code);
  return codes.length ? codes : [fallbackFactoryCode];
}

function sameFactoryScope(currentCodes, nextCodes) {
  const current = [...new Set(currentCodes)].sort();
  const next = [...new Set(nextCodes)].sort();
  return current.length === next.length && current.every((code, index) => code === next[index]);
}

function replaceUserFactories(db, userId, codes) {
  db.prepare('DELETE FROM user_factories WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO user_factories (user_id, factory_code) VALUES (?, ?)');
  for (const code of codes) insert.run(userId, code);
  db.prepare('UPDATE users SET factory_code = ? WHERE id = ?').run(codes[0], userId);
}

function runTransaction(db, operation) {
  db.exec('BEGIN');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function changeUserFactories(db, userId, nextFactoryCodes) {
  const user = db.prepare('SELECT factory_code FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const codes = [...new Set(nextFactoryCodes)];
  if (!codes.length) throw new Error('factory scope cannot be empty');
  const currentCodes = factoryCodesForUser(db, userId, user.factory_code);
  if (sameFactoryScope(currentCodes, codes)) return { changed: false, clearedCustomers: 0 };

  return runTransaction(db, () => {
    replaceUserFactories(db, userId, codes);
    const clearedCustomers = db.prepare('DELETE FROM user_customers WHERE user_id = ?').run(userId).changes;
    return { changed: true, clearedCustomers };
  });
}

function changeUserRole(db, userId, role, nextFactoryCodes, applyTemplate) {
  const user = db.prepare('SELECT role, factory_code FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const codes = [...new Set(nextFactoryCodes)];
  if (!codes.length) throw new Error('factory scope cannot be empty');
  const currentCodes = factoryCodesForUser(db, userId, user.factory_code);
  const factoriesChanged = !sameFactoryScope(currentCodes, codes);
  const adminBoundaryChanged = user.role !== role && (user.role === 'admin' || role === 'admin');

  return runTransaction(db, () => {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    let clearedCustomers = 0;
    if (factoriesChanged) {
      replaceUserFactories(db, userId, codes);
    }
    if (factoriesChanged || adminBoundaryChanged) {
      clearedCustomers = db.prepare('DELETE FROM user_customers WHERE user_id = ?').run(userId).changes;
    }
    applyTemplate(userId);
    return { factoriesChanged, clearedCustomers };
  });
}

function changeUserFactory(db, userId, nextFactoryCode) {
  return changeUserFactories(db, userId, [nextFactoryCode]);
}

module.exports = { changeUserFactories, changeUserRole, changeUserFactory };
