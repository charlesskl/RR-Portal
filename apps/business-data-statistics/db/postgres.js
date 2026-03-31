const { Pool, types } = require('pg');

// 修复时区问题：让 DATE 类型(OID=1082) 直接返回 "2026-03-09" 字符串
// 而不是转成 JS Date 对象（Date 对象会因 UTC 转换导致日期差一天）
types.setTypeParser(1082, val => val);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'production_system',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123',
});

// 查询辅助：支持 ? 占位符自动转 $N
function convertSql(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

async function query(sql, params = []) {
  const result = await pool.query(convertSql(sql), params);
  return result;
}

async function getOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

async function getAll(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

module.exports = { pool, query, getOne, getAll };
