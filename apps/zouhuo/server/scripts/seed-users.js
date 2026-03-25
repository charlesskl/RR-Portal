const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

async function seed() {
  if (fs.existsSync(USERS_FILE)) {
    const existing = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (existing.length > 0) {
      console.log('用户数据已存在，跳过创建。如需重置请删除 data/users.json');
      return;
    }
  }

  const password = await bcrypt.hash('admin123', 10);
  const users = [
    {
      _id: crypto.randomBytes(12).toString('hex'),
      username: 'admin',
      password,
      role: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  console.log('初始用户创建成功:');
  console.log('  用户名: admin');
  console.log('  密码: admin123');
  console.log('  请登录后尽快修改密码！');
}

seed().catch(err => {
  console.error('种子脚本失败:', err);
  process.exit(1);
});
