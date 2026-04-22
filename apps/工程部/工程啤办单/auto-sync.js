/**
 * auto-sync.js
 * 监听文件改动，自动 git add + commit + push 到 GitHub
 * 运行: node auto-sync.js
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEBOUNCE_MS = 3000; // 改动后等3秒再提交，防止连续改动重复提交

// 监听这些目录/文件
const WATCH_PATHS = [
  'public',
  'data',
  'server.js',
  'package.json',
];

// 忽略这些文件
const IGNORE = [
  'node_modules',
  '.git',
  'auto-sync.js',
  '.log',
];

let timer = null;
let pendingChanges = new Set();

function shouldIgnore(filePath) {
  return IGNORE.some(p => filePath.includes(p));
}

function runCommand(cmd) {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: e.message };
  }
}

function autoCommitPush() {
  const files = Array.from(pendingChanges);
  pendingChanges.clear();

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`\n[${timestamp}] 检测到改动: ${files.join(', ')}`);

  // git add all
  const add = runCommand('git add -A');
  if (!add.ok) {
    console.error('git add 失败:', add.out);
    return;
  }

  // check if there's actually anything to commit
  const status = runCommand('git status --porcelain');
  if (!status.out.trim()) {
    console.log('没有需要提交的改动');
    return;
  }

  // git commit
  const msg = `Auto-sync: ${timestamp}`;
  const commit = runCommand(`git commit -m "${msg}"`);
  if (!commit.ok) {
    console.error('git commit 失败:', commit.out);
    return;
  }
  console.log('Committed:', msg);

  // git push
  const push = runCommand('git push origin main');
  if (!push.ok) {
    console.error('git push 失败:', push.out);
    return;
  }
  console.log('已推送到 GitHub');
}

function onFileChange(eventType, filePath) {
  if (shouldIgnore(filePath)) return;

  pendingChanges.add(filePath);

  // debounce: 等待3秒无新改动再提交
  if (timer) clearTimeout(timer);
  timer = setTimeout(autoCommitPush, DEBOUNCE_MS);
}

// 启动监听
console.log('=== Auto-sync 启动 ===');
console.log('监听目录:', WATCH_PATHS.join(', '));
console.log('改动后 3 秒自动 commit + push 到 GitHub');
console.log('按 Ctrl+C 停止\n');

WATCH_PATHS.forEach(p => {
  const fullPath = path.join(ROOT, p);
  if (!fs.existsSync(fullPath)) return;

  const isDir = fs.statSync(fullPath).isDirectory();
  fs.watch(fullPath, { recursive: isDir }, (eventType, filename) => {
    onFileChange(eventType, filename || p);
  });
});
