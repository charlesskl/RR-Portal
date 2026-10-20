const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
// One atomic snapshot contains both business facts and all command receipts.
function writeJSON(file, value) {
 const target = path.resolve(file), dir = path.dirname(target);
 if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw Error('业务快照必须为普通文件');
 const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
 const temp = path.join(dir,'.printlink-snapshot-' + randomUUID());
 let fd;
 try {
  fd = fs.openSync(temp,'wx',mode); fs.writeFileSync(fd,JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
  fs.renameSync(temp,target);
  // POSIX requires directory fsync for rename durability. Windows does not offer it.
  if (process.platform !== 'win32') { const d = fs.openSync(dir,'r'); try {fs.fsyncSync(d);} finally {fs.closeSync(d);} }
 } finally {
  if (fd !== undefined) fs.closeSync(fd);
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
 }
}
function protect(data, previous, privileged) {
 const before = previous?._printlinkAuthority, incoming = data._printlinkAuthority;
 if (!privileged) {
  if (before) data._printlinkAuthority = structuredClone(before);
  else delete data._printlinkAuthority;
  return;
 }
 if (before?.enabled && (!incoming?.enabled || incoming.station !== before.station || incoming.clientId !== before.clientId)) throw Error('不能更改现场记账绑定');
 for (const [id,receipt] of Object.entries(before?.receipts || {})) {
  if (JSON.stringify(incoming?.receipts?.[id]) !== JSON.stringify(receipt)) throw Error('不能删除或修改已落盘回执');
 }
}
module.exports = {writeJSON,protect};
