// 生产默认使用 PostgreSQL。测试和迁移脚本显式设置 DB_DRIVER=sqlite/DB_FILE。
if (process.env.DB_DRIVER === 'sqlite' || (process.env.DB_FILE && !process.env.DATABASE_URL)) {
  module.exports = require('./sqlite');
} else {
  module.exports = require('./postgres');
}
