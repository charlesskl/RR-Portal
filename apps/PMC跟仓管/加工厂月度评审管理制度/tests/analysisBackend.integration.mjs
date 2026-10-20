// Local synthetic database only. Run with POCKETBASE_BINARY=/path/to/pocketbase node --test tests/analysisBackend.integration.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import PocketBase from 'pocketbase'
test('personal analysis followups isolate owners and enforce immutable keys', { timeout: 30000 }, async t => {
  assert.ok(process.env.POCKETBASE_BINARY, 'Set POCKETBASE_BINARY')
  const dir = await mkdtemp(join(tmpdir(), 'analysis-test-')), migrations = join(dir, 'migrations')
  await mkdir(migrations)
  const pass = randomBytes(18).toString('hex')
  await writeFile(join(migrations, '1700000000_fixture.js'), `migrate(app => {
    const c = app.findCollectionByNameOrId('users');
    for (const name of ['first','second']) { const u = new Record(c); u.setEmail(name+'@example.invalid'); u.setPassword('${pass}'); app.save(u); }
  }, app => app.delete(app.findCollectionByNameOrId('users')))`)
  await copyFile(new URL('../pb_migrations/1792454400_create_analysis_followups.js', import.meta.url), join(migrations, '1792454400_create_analysis_followups.js'))
  const flags = ['--dir='+join(dir,'data'), '--migrationsDir='+migrations, '--hooksDir='+join(dir,'hooks')]
  const run = args => { const r = spawnSync(process.env.POCKETBASE_BINARY, [...args,...flags], {encoding:'utf8'}); assert.equal(r.status,0,r.stderr); assert.doesNotMatch(r.stdout+r.stderr,/^Error:/m); return r }
  run(['migrate','up'])
  const socket = createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening'); const port=socket.address().port; await new Promise(r=>socket.close(r))
  const child=spawn(process.env.POCKETBASE_BINARY,['serve',`--http=127.0.0.1:${port}`,...flags],{stdio:'ignore'})
  t.after(async()=>{ if(child.exitCode===null){ const exited=once(child,'exit'); child.kill(); await exited } await rm(dir,{recursive:true,force:true}) })
  const first=new PocketBase(`http://127.0.0.1:${port}`),second=new PocketBase(first.baseURL),guest=new PocketBase(first.baseURL)
  for(let n=0;n<100;n++){try{await first.health.check();break}catch{await new Promise(r=>setTimeout(r,50))}}
  await first.collection('users').authWithPassword('first@example.invalid',pass)
  await second.collection('users').authWithPassword('second@example.invalid',pass)
  const owner=first.authStore.record.id, other=second.authStore.record.id
  const row=await first.collection('analysis_followups').create({owner,issue_key:'delivery:fixture:2026-10-01',status:'following'})
  assert.equal((await second.collection('analysis_followups').getFullList()).length,0)
  await assert.rejects(second.collection('analysis_followups').getOne(row.id))
  await assert.rejects(second.collection('analysis_followups').update(row.id,{status:'resolved'}))
  await assert.rejects(second.collection('analysis_followups').delete(row.id))
  await assert.rejects(second.collection('analysis_followups').create({owner,issue_key:'forged',status:'pending'}))
  await assert.rejects(guest.collection('analysis_followups').create({owner,issue_key:'guest',status:'pending'}))
  await assert.rejects(first.collection('analysis_followups').update(row.id,{owner:other}))
  await assert.rejects(first.collection('analysis_followups').update(row.id,{issue_key:'changed'}))
  await assert.rejects(first.collection('analysis_followups').update(row.id,{status:'invalid'}))
  await assert.rejects(first.collection('analysis_followups').create({owner,issue_key:row.issue_key,status:'pending'}))
  assert.equal((await first.collection('analysis_followups').update(row.id,{status:'resolved'})).status,'resolved')
  await second.collection('analysis_followups').create({owner:other,issue_key:row.issue_key,status:'pending'})
  const exited=once(child,'exit');child.kill();await exited
  run(['migrate','down','1','--automigrate=false']);run(['migrate','up'])
})
