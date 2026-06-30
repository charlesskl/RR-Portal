/* 一次性脚本：从 ../app.js 中精确提取 SEED_RECORDS / _DEFAULT_DEFECT_LIB / 默认账号
   写入 seed.json，供 server.js 首次建库时灌入数据库。
   做法：stub 浏览器全局对象后 eval app.js，把需要的常量改挂到 globalThis 再读取。*/
const fs = require('node:fs');
const path = require('node:path');

let src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// 把目标 const 声明改为 globalThis 赋值，使其在 eval 后可读
src = src.replace('const SEED_RECORDS =', 'globalThis.__SEED =');
src = src.replace('const _DEFAULT_DEFECT_LIB =', 'globalThis.__DLIB =');

// stub 浏览器环境，避免 app.js 顶层的 document/window/localStorage 调用报错
globalThis.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
globalThis.window = globalThis;
globalThis.addEventListener = function () {};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'zh-CN' };
globalThis.matchMedia = function () { return { matches: false, addEventListener() {}, addListener() {} }; };
globalThis.print = function () {};

// 间接 eval（全局作用域，非严格），函数声明会挂到 globalThis
(0, eval)(src);

// _hashPwd 是 app.js 里的函数声明；取不到就本地复刻同款 djb2
const _hashPwd = (typeof globalThis._hashPwd === 'function')
  ? globalThis._hashPwd
  : function (str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i); return (h >>> 0).toString(16); };

const seed = {
  records: globalThis.__SEED || [],
  defectLib: globalThis.__DLIB || [],
  users: [{
    username: 'jc',
    password: _hashPwd('qqwwee'),
    role: 'admin',
    enabled: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  }],
};

fs.writeFileSync(path.join(__dirname, 'seed.json'), JSON.stringify(seed, null, 2), 'utf8');
console.log('seed.json 写入完成：records =', seed.records.length,
  ', defectLib =', seed.defectLib.length,
  ', users =', seed.users.length,
  ', jc.hash =', seed.users[0].password);
