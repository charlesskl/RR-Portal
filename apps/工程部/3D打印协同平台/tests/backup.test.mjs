import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {backup,verify,restore} from '../ops/backup.mjs';
import {lockData} from '../ops/lock.mjs';

test('offline backup restores committed WAL data, attachments and secrets; rejects running data, tampering and overwrites',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'printlink-backup-')),source=path.join(dir,'source'),saved=path.join(dir,'saved'),target=path.join(dir,'restored');
 try {
  mkdirSync(path.join(source,'orders/uploads'),{recursive:true});mkdirSync(path.join(source,'collector'));mkdirSync(path.join(source,'product-files'));
  const orders=new DatabaseSync(path.join(source,'orders/printlink.sqlite'));orders.exec("PRAGMA journal_mode=WAL;CREATE TABLE sessions(token TEXT);INSERT INTO sessions VALUES('old-session');CREATE TABLE orders(id TEXT);INSERT INTO orders VALUES('order-1')");
  const production=new DatabaseSync(path.join(source,'production.sqlite'));production.exec("CREATE TABLE snapshot(value TEXT);INSERT INTO snapshot VALUES('inventory-123')");production.close();
  writeFileSync(path.join(source,'orders/uploads/model.stl'),'solid test');writeFileSync(path.join(source,'product-files/photo.png'),'image');writeFileSync(path.join(source,'secrets.json'),'{"test":"secret"}');writeFileSync(path.join(source,'collector/outbox.sqlite'),'excluded');
  const unlock=lockData(source,'platform');assert.throws(()=>backup(source,saved),/正在使用/);unlock();
  backup(source,saved);orders.close();assert.equal(verify(saved).files,5);assert.equal(verify(saved).files,5);assert.ok(!existsSync(path.join(saved,'collector')));
  restore(saved,target);const restored=new DatabaseSync(path.join(target,'orders/printlink.sqlite'));assert.equal(restored.prepare('SELECT id FROM orders').get().id,'order-1');assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);restored.close();
  assert.equal(readFileSync(path.join(target,'orders/uploads/model.stl'),'utf8'),'solid test');assert.equal(readFileSync(path.join(target,'secrets.json'),'utf8'),'{"test":"secret"}');
  assert.throws(()=>restore(saved,target),/已存在/);assert.throws(()=>backup(source,path.join(source,'nested')),/源目录内/);
  writeFileSync(path.join(saved,'orders/uploads/model.stl'),'tampered');assert.throws(()=>verify(saved),/校验失败/);assert.throws(()=>restore(saved,path.join(dir,'invalid')),/校验失败/);assert.ok(!existsSync(path.join(dir,'invalid')));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
