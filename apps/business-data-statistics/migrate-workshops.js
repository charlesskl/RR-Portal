const { query, getAll } = require('./db/postgres');

async function migrate() {
  // 1. Add company column
  await query('ALTER TABLE workshops ADD COLUMN IF NOT EXISTS company VARCHAR(100)');
  console.log('Added company column');

  // 2. Make department nullable
  await query('ALTER TABLE workshops ALTER COLUMN department DROP NOT NULL');
  console.log('Made department nullable');

  // 3. Check existing records
  const beerCount = await getAll('SELECT COUNT(*) as c FROM beer_records');
  const printCount = await getAll('SELECT COUNT(*) as c FROM print_records');
  const assemblyCount = await getAll('SELECT COUNT(*) as c FROM assembly_records');
  console.log('Existing records - beer:', beerCount[0].c, 'print:', printCount[0].c, 'assembly:', assemblyCount[0].c);

  // 4. Clear test records that reference old workshop IDs
  await query('DELETE FROM beer_records');
  await query('DELETE FROM print_records');
  await query('DELETE FROM assembly_records');
  console.log('Cleared test records');

  // 5. Delete old workshops
  await query('DELETE FROM workshops');
  console.log('Deleted old workshops');

  // 5. Reset sequence
  await query('ALTER SEQUENCE workshops_id_seq RESTART WITH 1');

  // 6. Insert new workshops
  const workshopsData = [
    // 清溪厂区 - 兴信公司
    ['兴信A', '兴信', '清溪', 'beer', 1],
    ['兴信A', '兴信', '清溪', 'print', 2],
    ['兴信A', '兴信', '清溪', 'assembly', 3],
    ['兴信B', '兴信', '清溪', null, 4],
    // 清溪厂区 - 华登公司
    ['华登A', '华登', '清溪', 'beer', 5],
    ['华登A', '华登', '清溪', 'print', 6],
    ['华登A', '华登', '清溪', 'assembly', 7],
    ['华登B', '华登', '清溪', 'clothing', 8],
    // 清溪厂区 - 登信
    ['登信', '登信', '清溪', 'electronic', 9],
    // 清溪厂区 - 华嘉
    ['华嘉', '华嘉', '清溪', 'assembly', 10],
    // 清溪厂区 - 小部门
    ['小部门', '小部门', '清溪', 'blister', 11],
    ['小部门', '小部门', '清溪', 'bags', 12],
    ['小部门', '小部门', '清溪', 'color_mixing', 13],
    // 河源厂区
    ['华登', '华登', '河源', null, 1],
    ['华兴', '华兴', '河源', null, 2],
    ['华康', '华康', '河源', null, 3],
    // 湖南厂区
    ['邵阳兴信', '邵阳兴信', '湖南', null, 1],
    ['邵阳华登', '邵阳华登', '湖南', null, 2]
  ];

  for (const [name, company, region, department, sort_order] of workshopsData) {
    await query(
      'INSERT INTO workshops (name, company, region, department, sort_order) VALUES (?, ?, ?, ?, ?)',
      [name, company, region, department, sort_order]
    );
  }
  console.log('Inserted', workshopsData.length, 'workshops');

  // 7. Verify
  const all = await getAll('SELECT * FROM workshops ORDER BY region, sort_order');
  console.log('Total workshops:', all.length);
  for (const w of all) {
    console.log('  [' + w.region + '] ' + w.company + ' > ' + w.name + ' : ' + (w.department || '(无部门)'));
  }

  process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });
