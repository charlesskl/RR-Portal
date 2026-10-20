// Run explicitly with Node 24 and the production-pinned PocketBase binary:
// POCKETBASE_BINARY=/path/to/pocketbase node --test tests/qualityPatrolBackend.integration.mjs
// This harness never downloads binaries or connects to a non-loopback address.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import PocketBase from 'pocketbase'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migration = '1792368000_create_quality_patrols.js'
const templateMigration = '1792537200_extend_patrol_template02.js'
const password = 'Synthetic941_' + randomBytes(16).toString('hex')
const id = value => value.padEnd(15, '0')
const factories = [
  { id: id('hnsewing'), region: 'hunan', craft: 'sewing' },
  { id: id('dgsewing'), region: '', craft: 'sewing' },
  { id: id('hnelectronics'), region: 'hunan', craft: 'electronics' },
  { id: id('hyinjection'), region: 'heyuan', craft: 'injection' },
  { id: id('dgelectronics'), region: 'dongguan', craft: 'electronics' },
]
const people = [
  { name: 'admin', role: 'admin', edit: true },
  { name: 'buyer', role: 'buyer_sewing', edit: false },
  { name: 'noquality', permissions: { 'quality.view': false } },
  { name: 'nohunan', permissions: { 'region.hunan': false } },
  { name: 'sewing', crafts: ['sewing'] },
  { name: 'multi', crafts: ['sewing', 'electronics'], craft: 'injection' },
  { name: 'legacy', craft: 'sewing' },
  { name: 'invalidmodule', permissions: { 'quality.view': 'true' } },
  { name: 'invalidregion', permissions: { 'region.hunan': 1 } },
  { name: 'invalidobject', permissions: [] },
  { name: 'defaultnull', permissions: null },
  { name: 'noregions', permissions: { 'region.hunan': false, 'region.dongguan': false, 'region.heyuan': false } },
  { name: 'fileuser', crafts: ['sewing'] },
  { name: 'crossscope', crafts: ['electronics'], permissions: { 'region.hunan': false, 'region.heyuan': false } },
]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const quote = value => '"' + value.replaceAll('"', '""') + '"'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function inspect(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA query_only=ON')
  try {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    const tables = {}
    for (const { name } of schema.filter(row => row.type === 'table')) {
      tables[name] = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all()
    }
    return { schema, tables, collections: tables._collections }
  } finally { db.close() }
}
function run(binary, args, input) {
  const result = spawnSync(binary, args, { input, encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.error, undefined, 'PocketBase command did not complete')
  assert.equal(result.status, 0, `PocketBase ${args[0]} failed: ${result.stderr || result.stdout}`)
  assert.doesNotMatch(result.stdout + result.stderr, /^Error:/m, 'PocketBase CLI can print migration errors with exit status zero')
  return result.stdout
}
async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 1500)
  try { await exited } finally { clearTimeout(timer) }
}

test('PocketBase 0.39.6 patrol migration and HTTP authorization contract', { timeout: 60_000 }, async t => {
  assert.ok(process.env.POCKETBASE_BINARY, 'Set POCKETBASE_BINARY to the production-pinned 0.39.6 executable')
  const binary = resolve(process.env.POCKETBASE_BINARY)
  assert.match(run(binary, ['--version']), /version 0\.39\.6\s*$/)
  const temp = await mkdtemp(join(tmpdir(), 'quality-patrol-'))
  const data = join(temp, 'data'), migrations = join(temp, 'migrations'), hooks = join(temp, 'hooks')
  await Promise.all([mkdir(data), mkdir(migrations), mkdir(hooks)])
  let server, log
  const streams = []
  t.after(async () => {
    for (const stream of streams) await stream.close()
    await stop(server)
    log?.end()
    if (process.env.QUALITY_PATROL_KEEP_FIXTURE !== '1') await rm(temp, { recursive: true, force: true })
    else t.diagnostic(`Synthetic fixture retained at ${temp}`)
  })
  const prior = (await readdir(join(app, 'pb_migrations'))).filter(name => name.endsWith('.js') && ![migration, templateMigration].includes(name)).sort()
  for (const file of prior) await copyFile(join(app, 'pb_migrations', file), join(migrations, file))
  const flags = ['--dir=' + data, '--migrationsDir=' + migrations, '--hooksDir=' + hooks]
  run(binary, ['migrate', 'up', ...flags])
  // This seed is outside the repository and precedes the feature migration.
  await writeFile(join(migrations, '1791000000_fixture.js'), `migrate(app => {
    const users = app.findCollectionByNameOrId('users');
    for (const p of ${JSON.stringify(people)}) {
      const r = new Record(users); r.set('id', p.name.padEnd(15,'0')); r.set('email',p.name+'@fixture.invalid');
      r.set('password',${JSON.stringify(password)}); r.set('passwordConfirm',${JSON.stringify(password)});
      r.set('verified',true); r.set('role',p.role || 'quality_qc'); r.set('quality_edit',p.edit !== false);
      r.set('permissions',p.permissions === undefined ? {} : p.permissions); r.set('crafts',p.crafts || []); r.set('craft',p.craft || ''); app.save(r);
    }
    const fc = app.findCollectionByNameOrId('factories');
    for (const f of ${JSON.stringify(factories)}) {
      const r = new Record(fc); for (const key in f) r.set(key,f[key]); r.set('name',f.id);r.set('status','active');app.save(r);
    }
    const order = new Record(app.findCollectionByNameOrId('orders'));
    order.set('factory',${JSON.stringify(factories[0].id)});order.set('product','existing synthetic business row');order.set('quantity',37);app.save(order);
    const superuser = new Record(app.findCollectionByNameOrId('_superusers'));
    superuser.set('email','super@fixture.invalid');superuser.set('password',${JSON.stringify(password)});superuser.set('passwordConfirm',${JSON.stringify(password)});app.save(superuser);
    const other = new Collection({name:'fixture_other_auth',type:'auth',passwordAuth:{enabled:true,identityFields:['email']}});app.save(other);
    const outsider = new Record(other);outsider.set('id','otherauth'.padEnd(15,'0'));outsider.set('email','other@fixture.invalid');outsider.set('password',${JSON.stringify(password)});outsider.set('passwordConfirm',${JSON.stringify(password)});app.save(outsider);
  }, app => {})`)
  run(binary, ['migrate', 'up', ...flags])
  const before = inspect(join(data, 'data.db'))
  await copyFile(join(app, 'pb_migrations', migration), join(migrations, migration))
  run(binary, ['migrate', 'up', ...flags])
  const after = inspect(join(data, 'data.db'))
  const passedChecks = []
  const check = (name, action) => t.test(name, async () => { await action(); passedChecks.push(name) })
  await check('new migration preserves every old schema object, collection and business row', () => {
    assert.ok(prior.length >= 66)
    for (const row of before.schema) assert.deepEqual(after.schema.find(item => item.name === row.name), row)
    for (const row of before.collections) assert.deepEqual(after.collections.find(item => item.id === row.id), row)
    for (const [name, rows] of Object.entries(before.tables)) {
      if (!['_migrations', '_collections'].includes(name)) assert.deepEqual(after.tables[name], rows, name)
    }
    assert.equal(after.collections.length, before.collections.length + 2)
    assert.equal(after.tables._migrations.length, before.tables._migrations.length + 1)
    assert.deepEqual(after.tables.quality_patrols, [])
    const grant = after.collections.find(row => row.name === 'quality_patrol_access')
    assert.equal(grant.listRule, null)
    assert.equal(grant.viewRule, null)
    const patrol = after.collections.find(row => row.name === 'quality_patrols')
    assert.equal(JSON.parse(patrol.fields).find(field => field.name === 'photos').protected, true)
  })
  await check('template 02 migration preserves existing visits and access rules', async () => {
    const db = new DatabaseSync(join(data, 'data.db'))
    db.prepare('INSERT INTO quality_patrols (id,factory,check_date,staff,notes,planned_date) VALUES (?,?,?,?,?,?)')
      .run(id('legacyvisit'), factories[0].id, '2026-10-16 00:00:00.000Z', '40', 'existing visit', '2026-10-21 00:00:00.000Z')
    db.close()
    const old = inspect(join(data, 'data.db'))
    await copyFile(join(app, 'pb_migrations', templateMigration), join(migrations, templateMigration))
    run(binary, ['migrate', 'up', ...flags])
    const updated = inspect(join(data, 'data.db'))
    for (const [key, value] of Object.entries(old.tables.quality_patrols[0])) assert.deepEqual(updated.tables.quality_patrols[0][key], value)
    const original = old.collections.find(c => c.name === 'quality_patrols'), current = updated.collections.find(c => c.name === 'quality_patrols')
    for (const key of ['listRule','viewRule','createRule','updateRule','deleteRule']) assert.equal(current[key], original[key])
    const cleanup = new DatabaseSync(join(data, 'data.db'))
    cleanup.prepare('DELETE FROM quality_patrols WHERE id=?').run(id('legacyvisit')); cleanup.close()
  })
  await copyFile(join(app, 'pb_hooks', 'quality_patrols.pb.js'), join(hooks, 'quality_patrols.pb.js'))
  const base = 'http://127.0.0.1:' + await freePort()
  log = createWriteStream(join(temp, 'server.log'), { mode: 0o600 })
  server = spawn(binary, ['serve', '--http=' + base.slice(7), '--hooksWatch=false', ...flags], { stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.pipe(log); server.stderr.pipe(log)
  async function request(method, path, body, token) {
    const headers = token ? { Authorization: token } : {}
    if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = typeof body === 'string' ? body : JSON.stringify(body) }
    const response = await fetch(base + path, { method, headers, body, signal: AbortSignal.timeout(5000) })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch {}
    return { status: response.status, json, text }
  }
  let ready = false
  for (let attempts = 0; attempts < 100; attempts++) {
    assert.equal(server.exitCode, null, 'PocketBase exited during startup')
    try { ready = (await request('GET', '/api/health')).status === 200 } catch {}
    if (ready) break
    await delay(50)
  }
  assert.ok(ready, 'PocketBase startup timed out')
  const tokens = {}
  for (const person of people) {
    const result = await request('POST', '/api/collections/users/auth-with-password', { identity: person.name + '@fixture.invalid', password })
    assert.equal(result.status, 200, 'Synthetic login failed for ' + person.name)
    tokens[person.name] = result.json.token
  }
  for (const [name, collection, email] of [['super', '_superusers', 'super'], ['other', 'fixture_other_auth', 'other']]) {
    const result = await request('POST', `/api/collections/${collection}/auth-with-password`, { identity: email + '@fixture.invalid', password })
    assert.equal(result.status, 200); tokens[name] = result.json.token
  }
  const api = '/api/collections/quality_patrols/records'
  const originalRows = []
  const create = (payload, token = tokens.admin) => request('POST', api, payload, token)
  for (const factory of factories) {
    const result = await create({ factory: factory.id, check_date: '2026-10-19', grade: 'A', staff: 12, notes: 'scope:' + factory.id })
    assert.equal(result.status, 200); originalRows.push(result.json)
  }
  await check('native list pagination, single views and client filters enforce module, region and craft', async () => {
    const scopes = { admin: 5, buyer: 5, noquality: 0, nohunan: 3, sewing: 2, multi: 4, legacy: 2, invalidmodule: 0, invalidregion: 3, invalidobject: 0, defaultnull: 5, noregions: 0, other: 0, crossscope: 1 }
    for (const [name, count] of Object.entries(scopes)) {
      const listed = await request('GET', api + '?perPage=1&sort=factory', undefined, tokens[name])
      assert.equal(listed.status, 200, name); assert.equal(listed.json.totalItems, count, name)
      let seen = 0
      for (let page = 1; page <= listed.json.totalPages; page++) {
        const result = await request('GET', api + '?perPage=1&page=' + page, undefined, tokens[name])
        seen += result.json.items.length
      }
      assert.equal(seen, count, name)
    }
    assert.equal((await request('GET', api)).json.totalItems, 0)
    for (const name of ['noquality', 'nohunan', 'noregions', 'invalidmodule', 'invalidregion', 'invalidobject', 'other', 'crossscope']) {
      assert.equal((await request('GET', api + '/' + originalRows[0].id, undefined, tokens[name])).status, 404, name)
    }
    const filter = new URLSearchParams({ filter: `factory='${factories[2].id}' || grade='A'`, perPage: '100' })
    const filtered = await request('GET', api + '?' + filter, undefined, tokens.sewing)
    assert.equal(filtered.json.totalItems, 2)
    assert.ok(filtered.json.items.every(row => [factories[0].id, factories[1].id].includes(row.factory)))
    assert.equal((await request('GET', '/api/collections/quality_patrol_access/records', undefined, tokens.admin)).status, 403)
    const crossed = await request('GET', api + '?perPage=100', undefined, tokens.crossscope)
    assert.deepEqual(crossed.json.items.map(row => row.factory), [factories[4].id], 'membership user and factory must match the SAME view row')
  })
  await check('reverse relation expansion cannot disclose unauthorized patrol rows', async () => {
    for (const [factory, expected] of [[factories[0], 1], [factories[2], 0]]) {
      const result = await request('GET', `/api/collections/factories/records/${factory.id}?expand=quality_patrols_via_factory`, undefined, tokens.sewing)
      assert.equal(result.status, 200)
      assert.equal((result.json.expand?.quality_patrols_via_factory || []).length, expected)
    }
  })
  await check('write permissions check both old and replacement factory, including deletes', async () => {
    const payload = { factory: factories[0].id, check_date: '2026-10-20' }
    for (const name of ['buyer', 'noquality', 'nohunan', 'noregions', 'other']) assert.equal((await create(payload, tokens[name])).status, 400, name)
    assert.equal((await request('PATCH', api + '/' + originalRows[0].id, { factory: factories[2].id }, tokens.sewing)).status, 403)
    assert.equal((await request('PATCH', api + '/' + originalRows[2].id, { factory: factories[0].id }, tokens.sewing)).status, 404)
    assert.equal((await request('DELETE', api + '/' + originalRows[0].id, undefined, tokens.buyer)).status, 404)
    assert.equal((await request('GET', api + '/' + originalRows[0].id, undefined, tokens.admin)).json.factory, factories[0].id)
  })
  let nextDay = 0
  const day = () => new Date(Date.UTC(2027, 0, ++nextDay)).toISOString().slice(0, 10)
  await check('template 02 fields round-trip and processing fees reject invalid JSON types', async () => {
    const fields = { responsibility_scope:'责任人甲', responsible_supervisor:'主管乙', processing_fee_period:'1月-9月份', processing_fee:338.25, completion_details:'1:10/21完成\n2:10/26完成' }
    const created = await create({ factory:factories[0].id, check_date:day(), ...fields })
    assert.equal(created.status, 200)
    for (const [key, value] of Object.entries(fields)) assert.equal(created.json[key], value)
    for (const value of [-1, '12', {}, [], true]) assert.equal((await create({factory:factories[0].id,check_date:day(),processing_fee:value})).status, 400)
    const body = new FormData(); body.set('factory',factories[0].id);body.set('check_date',day());body.set('processing_fee','0')
    assert.equal((await create(body)).json.processing_fee,0)
    body.set('check_date',day());body.set('processing_fee','null')
    assert.equal((await create(body)).json.processing_fee,null)
  })
  await check('strict JSON numbers preserve null/zero and reject strings, containers, overflow and unsafe integers', async () => {
    for (const [key, value] of [['staff', -1], ['staff', 1.1], ['staff', 2 ** 53], ['staff', '12'], ['staff', 'null'], ['lines', []], ['lines', {}], ['area', true], ['area', -1]]) {
      assert.equal((await create({ factory: factories[0].id, check_date: day(), [key]: value })).status, 400, key + ':' + JSON.stringify(value))
    }
    assert.equal((await create(`{"factory":"${factories[0].id}","check_date":"${day()}","area":1e309}`)).status, 400)
    const good = await create({ factory: factories[0].id, check_date: day(), staff: 0, lines: null, area: 12.25 })
    assert.equal(good.status, 200); assert.equal(good.json.staff, 0); assert.equal(good.json.lines, null); assert.equal(good.json.area, 12.25)
    assert.equal((await request('PATCH', api + '/' + good.json.id, { notes: 'numbers unchanged' }, tokens.admin)).status, 200)
    const badForm = new FormData(); badForm.set('factory', factories[0].id); badForm.set('check_date', day()); badForm.set('staff', '"12"')
    assert.equal((await create(badForm)).status, 400)
  })
  await check('UTC day normalization validates previous days, timezones, malformed optional dates and concurrent creates/updates', async () => {
    for (const fields of [
      { check_date: 'not-a-date' }, { check_date: '2026-02-31' },
      { check_date: '2027-03-01', planned_date: 'not-a-date' },
      { check_date: '2027-03-01T23:00:00Z', previous_date: '2027-03-01T01:00:00Z' },
    ]) assert.equal((await create({ factory: factories[0].id, ...fields })).status, 400)
    const first = await create({ factory: factories[0].id, check_date: '2027-03-02T00:30:00+08:00', previous_date: '2027-02-28T23:00:00Z', planned_date: '2027-03-03T22:30:00Z' })
    assert.equal(first.status, 200); assert.equal(first.json.check_date.slice(0, 19), '2027-03-01 00:00:00'); assert.equal(first.json.planned_date.slice(11, 19), '00:00:00')
    assert.equal((await create({ factory: factories[0].id, check_date: '2027-03-01T18:00:00Z' })).status, 400)
    const created = await Promise.all(['01:00:00', '18:00:00'].map(time => create({ factory: factories[0].id, check_date: '2027-03-04T' + time + 'Z' })))
    assert.deepEqual(created.map(result => result.status).sort(), [200, 400])
    const a = await create({ factory: factories[0].id, check_date: '2027-03-05' })
    const b = await create({ factory: factories[0].id, check_date: '2027-03-06' })
    const updated = await Promise.all([a, b].map(row => request('PATCH', api + '/' + row.json.id, { check_date: '2027-03-07T12:00:00Z' }, tokens.admin)))
    assert.deepEqual(updated.map(result => result.status).sort(), [200, 400])
    // Prove the DB guard itself rejects a noncanonical time if a trusted internal
    // writer bypasses request hooks; testing canonical HTTP writes alone cannot.
    const db = new DatabaseSync(join(data, 'data.db'))
    try { assert.throws(() => db.prepare('INSERT INTO quality_patrols (id,factory,check_date) VALUES (?,?,?)').run(id('dbduplicate'), factories[0].id, '2027-03-04 23:00:00.000Z'), /UNIQUE constraint failed/) }
    finally { db.close() }
  })
  await check('superusers retain native bypass while business validation still applies', async () => {
    assert.equal((await request('GET', '/api/collections/quality_patrol_access/records', undefined, tokens.super)).status, 200)
    assert.equal((await create({ factory: factories[0].id, check_date: day(), staff: -1 }, tokens.super)).status, 400)
    assert.equal((await create({ factory: factories[0].id, check_date: day(), staff: 1 }, tokens.super)).status, 200)
  })
  await check('protected photos enforce tokens and current scope, retain/remove files and disappear after authorized deletion', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8/f4sAAAAASUVORK5CYII=', 'base64')
    const body = new FormData(); body.set('factory', factories[0].id); body.set('check_date', day()); body.set('staff', 'null'); body.set('lines', '0'); body.append('photos', new Blob([png], { type: 'image/png' }), 'one.png')
    const uploaded = await create(body); assert.equal(uploaded.status, 200); assert.equal(uploaded.json.staff, null); assert.equal(uploaded.json.lines, 0)
    const row = uploaded.json, name = row.photos[0]
    const path = file => `/api/files/quality_patrols/${row.id}/${file}`
    const fileTokens = {}
    for (const person of ['admin', 'fileuser', 'nohunan', 'noquality', 'other']) {
      const token = await request('POST', '/api/files/token', {}, tokens[person]); assert.equal(token.status, 200); fileTokens[person] = token.json.token
    }
    assert.equal((await request('GET', path(name))).status, 404)
    assert.equal((await request('GET', path(name) + '?token=invalid')).status, 404)
    for (const person of ['nohunan', 'noquality', 'other']) assert.equal((await request('GET', path(name) + '?token=' + fileTokens[person])).status, 404, person)
    for (const person of ['admin', 'fileuser']) assert.equal((await request('GET', path(name) + '?token=' + fileTokens[person])).status, 200, person)
    assert.equal((await request('PATCH', '/api/collections/users/records/' + id('fileuser'), { permissions: { 'quality.view': false } }, tokens.admin)).status, 200)
    assert.equal((await request('GET', path(name) + '?token=' + fileTokens.fileuser)).status, 404, 'previously issued token must honor revocation')
    const edit = new FormData(); edit.append('photos', ''); edit.append('photos', name); edit.append('photos', new Blob([png], { type: 'image/png' }), 'two.png')
    const added = await request('PATCH', api + '/' + row.id, edit, tokens.admin); assert.equal(added.status, 200); assert.equal(added.json.photos.length, 2); assert.ok(added.json.photos.includes(name))
    const removed = added.json.photos.find(file => file !== name)
    assert.equal((await request('PATCH', api + '/' + row.id, { photos: [name] }, tokens.admin)).status, 200)
    assert.equal((await request('GET', path(removed) + '?token=' + fileTokens.admin)).status, 404)
    assert.equal((await request('GET', path(name) + '?token=' + fileTokens.admin)).status, 200)
    assert.equal((await request('DELETE', api + '/' + row.id, undefined, tokens.admin)).status, 204)
    assert.equal((await request('GET', path(name) + '?token=' + fileTokens.admin)).status, 404)
  })
  await check('real SDK full UI multipart creates/edits retain photos, accept blank dates and reject malformed dates', async () => {
    const sdk = new PocketBase(base)
    sdk.authStore.save(tokens.admin, { id: id('admin') })
    sdk.autoCancellation(false)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8/f4sAAAAASUVORK5CYII=', 'base64')
    // Match every entry emitted by QualityPatrolView.save(), including the
    // optional blank dates/text, string booleans and initial empty photos entry.
    const draft = {
      factory: factories[0].id, visitor_ready: 'true', below_standard: 'false',
      staff: '40', lines: 'null', area: 'null', previous_grade: '', grade: 'A',
      previous_evaluation: '', previous_correction: '', previous_type: '',
      evaluation: '', correction: '', production_type: '', notes: 'Synthetic UI fixture only',
      check_date: '2027-04-01', previous_date: '', planned_date: '', completed_date: '',
    }
    const fullForm = (changes = {}, kept = [], upload = false) => {
      const form = new FormData()
      for (const [key, value] of Object.entries({ ...draft, ...changes })) form.append(key, value)
      form.append('photos', '')
      for (const name of kept) form.append('photos', name)
      if (upload) form.append('photos', new Blob([png], { type: 'image/png' }), 'full-form.png')
      return form
    }
    const created = await sdk.collection('quality_patrols').create(fullForm({}, [], true))
    assert.equal(created.staff, 40); assert.equal(created.lines, null); assert.equal(created.area, null)
    assert.equal(created.visitor_ready, true); assert.equal(created.photos.length, 1)
    for (const key of ['previous_date', 'planned_date', 'completed_date']) assert.equal(created[key], '')
    const edited = await sdk.collection('quality_patrols').update(created.id, fullForm({ notes: 'Synthetic full UI edit keeps photo' }, created.photos))
    assert.equal(edited.notes, 'Synthetic full UI edit keeps photo'); assert.deepEqual(edited.photos, created.photos)
    const filled = await sdk.collection('quality_patrols').update(created.id, fullForm({ previous_date: '2027-03-01', planned_date: '2027-04-10', completed_date: '2027-04-12' }, created.photos))
    assert.ok(filled.previous_date.startsWith('2027-03-01'))
    const cleared = await sdk.collection('quality_patrols').update(created.id, fullForm({}, created.photos))
    for (const key of ['previous_date', 'planned_date', 'completed_date']) assert.equal(cleared[key], '')
    for (const key of ['previous_date', 'planned_date', 'completed_date']) {
      await assert.rejects(sdk.collection('quality_patrols').update(created.id, fullForm({ [key]: 'not-a-date' }, created.photos)), error => error.status === 400)
    }
    const retained = await sdk.collection('quality_patrols').getOne(created.id)
    assert.deepEqual(retained.photos, created.photos)
    assert.equal(retained.staff, 40); assert.equal(retained.previous_date, '')
  })
  async function subscribe(token) {
    const controller = new AbortController()
    const response = await fetch(base + '/api/realtime', { signal: controller.signal })
    assert.equal(response.status, 200)
    const received = [], reader = response.body.getReader()
    const task = (async () => {
      let pending = ''
      const decoder = new TextDecoder()
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break
          pending += decoder.decode(part.value, { stream: true })
          let split
          while ((split = pending.indexOf('\n\n')) >= 0) {
            const block = pending.slice(0, split); pending = pending.slice(split + 2)
            const event = block.match(/^event: ?(.+)$/m)?.[1]
            const value = block.match(/^data: ?(.+)$/m)?.[1]
            if (value) received.push({ event, data: JSON.parse(value) })
          }
        }
      } catch (error) { if (!controller.signal.aborted) throw error }
    })()
    const waitFor = async predicate => {
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) { const found = received.find(predicate); if (found) return found; await delay(20) }
      throw new Error('Expected realtime event did not arrive')
    }
    const stream = { received, waitFor, close: async () => { controller.abort(); await task } }
    streams.push(stream)
    const connected = await waitFor(event => event.event === 'PB_CONNECT')
    assert.equal((await request('POST', '/api/realtime', { clientId: connected.data.clientId, subscriptions: ['quality_patrols/*', 'quality_patrols/' + originalRows[0].id] }, token)).status, 204)
    return stream
  }
  await check('realtime applies the same row policy for wildcard/single subscriptions and live permission revocation', async () => {
    const allowed = await subscribe(tokens.admin), limited = await subscribe(tokens.nohunan)
    assert.equal((await request('PATCH', api + '/' + originalRows[0].id, { notes: 'realtime forbidden HN' }, tokens.admin)).status, 200)
    assert.equal((await request('PATCH', api + '/' + originalRows[1].id, { notes: 'realtime allowed DG' }, tokens.admin)).status, 200)
    await allowed.waitFor(event => event.data.record?.notes === 'realtime forbidden HN')
    await limited.waitFor(event => event.data.record?.notes === 'realtime allowed DG')
    await delay(250)
    assert.ok(!limited.received.some(event => event.data.record?.notes === 'realtime forbidden HN'))
    assert.equal((await request('PATCH', '/api/collections/users/records/' + id('nohunan'), { permissions: { 'quality.view': false, 'region.hunan': false } }, tokens.admin)).status, 200)
    assert.equal((await request('PATCH', api + '/' + originalRows[1].id, { notes: 'realtime revoked DG' }, tokens.admin)).status, 200)
    await allowed.waitFor(event => event.data.record?.notes === 'realtime revoked DG')
    await delay(250)
    assert.ok(!limited.received.some(event => event.data.record?.notes === 'realtime revoked DG'))
    await allowed.close(); await limited.close()
  })
  await stop(server)
  await check('synthetic migration rollback removes only new objects and can reapply cleanly', () => {
    // Down is exercised only here on disposable synthetic data. Production
    // rollback must retain the new collection and never erase collected patrols.
    run(binary, ['migrate', 'down', '2', ...flags], 'y\n')
    const reverted = inspect(join(data, 'data.db'))
    for (const row of before.schema) assert.deepEqual(reverted.schema.find(item => item.name === row.name), row)
    for (const row of before.collections) assert.deepEqual(reverted.collections.find(item => item.id === row.id), row)
    assert.ok(!reverted.schema.some(row => ['quality_patrols', 'quality_patrol_access'].includes(row.name)))
    for (const name of ['orders', 'factories']) assert.deepEqual(reverted.tables[name], before.tables[name])
    run(binary, ['migrate', 'up', ...flags])
    const reapplied = inspect(join(data, 'data.db'))
    assert.deepEqual(reapplied.tables.quality_patrols, [])
    assert.ok(reapplied.schema.some(row => row.name === 'quality_patrol_access' && row.type === 'view'))
  })
  assert.equal(passedChecks.length, 13, 'Do not produce successful evidence after a failed subtest')
  if (process.env.QUALITY_PATROL_EVIDENCE) {
    const files = ['pb_hooks/quality_patrols.pb.js', 'pb_migrations/' + migration, 'pb_migrations/' + templateMigration, 'tests/qualityPatrolBackend.integration.mjs']
    const sourceHashes = {}
    for (const file of files) sourceHashes[file] = hash(await readFile(join(app, file)))
    await writeFile(process.env.QUALITY_PATROL_EVIDENCE, JSON.stringify({ pocketbase: '0.39.6', syntheticOnly: true, priorMigrationCount: prior.length, sourceHashes, passedChecks, oldSchemaPreserved: true, oldCollectionsPreserved: true, oldBusinessRowsPreservedDuringMigration: true, newObjects: after.schema.filter(row => !before.schema.some(old => old.name === row.name)), newCollectionMetadata: after.collections.filter(row => !before.collections.some(old => old.id === row.id)) }, null, 2), { mode: 0o600, flag: 'wx' })
  }
})
