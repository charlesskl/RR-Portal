import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import path from 'node:path';

// A stale lock deliberately requires operator investigation; PID reuse must not unlock it.
export function lockData(data, purpose) {
  const lock = path.join(data, '.platform-lock');
  try { mkdirSync(lock, {mode:0o700}); }
  catch (e) { if(e.code==='EEXIST') throw Error('数据目录正在使用或遗留锁未清理：'+lock+'。请先停止平台；异常退出后须确认全部子进程停止再清理此锁。'); throw e; }
  try { writeFileSync(path.join(lock,'owner.json'), JSON.stringify({pid:process.pid,purpose,created:new Date().toISOString()}), {mode:0o600}); }
  catch(e) { rmSync(lock,{recursive:true,force:true}); throw e; }
  return () => rmSync(lock,{recursive:true,force:true});
}
