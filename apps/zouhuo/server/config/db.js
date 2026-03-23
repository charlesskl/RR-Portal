const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// pkg 打包后 __dirname 是只读快照，数据目录改为 exe 同级
const BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeJSON(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
}

function genId() { return crypto.randomBytes(12).toString('hex'); }

class Col {
  constructor(name) { this.name = name; }
  find(q = {}) {
    return readJSON(this.name).filter(doc => {
      for (const [k, v] of Object.entries(q)) if (doc[k] !== v) return false;
      return true;
    });
  }
  findById(id) { return readJSON(this.name).find(d => d._id === id) || null; }
  findOne(q) { return this.find(q)[0] || null; }
  create(data) {
    const docs = readJSON(this.name);
    const now = new Date().toISOString();
    const doc = { _id: genId(), ...data, createdAt: now, updatedAt: now };
    docs.push(doc);
    writeJSON(this.name, docs);
    return doc;
  }
  update(id, data) {
    const docs = readJSON(this.name);
    const i = docs.findIndex(d => d._id === id);
    if (i === -1) return null;
    docs[i] = { ...docs[i], ...data, updatedAt: new Date().toISOString() };
    writeJSON(this.name, docs);
    return docs[i];
  }
  delete(id) {
    const docs = readJSON(this.name);
    const i = docs.findIndex(d => d._id === id);
    if (i === -1) return null;
    const [d] = docs.splice(i, 1);
    writeJSON(this.name, docs);
    return d;
  }
}

const db = {
  products: new Col('products'),   // 产品/走货明细记录
  rows: new Col('rows'),           // 走货明细行数据
  pricings: new Col('pricings'),   // 核价记录
  users: new Col('users'),         // 用户
};

module.exports = { db };
