const { query, getAll } = require('./db/postgres');

async function fix() {
  // Clear all
  await query('DELETE FROM beer_records');
  await query('DELETE FROM print_records');
  await query('DELETE FROM assembly_records');
  await query('DELETE FROM workshops');
  await query('ALTER SEQUENCE workshops_id_seq RESTART WITH 1');

  // Insert in exact order per user's screenshot
  const data = [
    // 清溪厂区 (sort 1-14)
    ['兴信A', '兴信', '清溪', 'beer', 1],
    ['兴信A', '兴信', '清溪', 'print', 2],
    ['兴信A', '兴信', '清溪', 'assembly', 3],
    ['兴信B', '兴信', '清溪', 'beer', 4],
    ['兴信B', '兴信', '清溪', 'assembly', 5],
    ['华登A', '华登', '清溪', 'beer', 6],
    ['华登A', '华登', '清溪', 'print', 7],
    ['华登A', '华登', '清溪', 'assembly', 8],
    ['华登B', '华登', '清溪', 'clothing', 9],
    ['登信',  '登信', '清溪', 'electronic', 10],
    ['小部门', '小部门', '清溪', 'blister', 11],
    ['小部门', '小部门', '清溪', 'bags', 12],
    ['小部门', '小部门', '清溪', 'color_mixing', 13],
    ['华嘉',  '华嘉', '清溪', 'assembly', 14],
    // 湖南厂区 (sort 1-2)
    ['邵阳华登', '邵阳华登', '湖南', null, 1],
    ['邵阳兴信', '邵阳兴信', '湖南', null, 2],
    // 河源厂区 (sort 1-3)
    ['华登', '华登', '河源', null, 1],
    ['华康', '华康', '河源', null, 2],
    ['华兴', '华兴', '河源', null, 3],
  ];

  for (const [name, company, region, department, sort_order] of data) {
    await query(
      'INSERT INTO workshops (name, company, region, department, sort_order) VALUES (?, ?, ?, ?, ?)',
      [name, company, region, department, sort_order]
    );
  }

  console.log('Inserted', data.length, 'workshops');

  // Verify
  const all = await getAll("SELECT * FROM workshops ORDER BY CASE region WHEN '清溪' THEN 1 WHEN '湖南' THEN 2 WHEN '河源' THEN 3 END, sort_order");
  console.log('ID | 厂区 | 公司 | 车间 | 部门 | 排序');
  for (const w of all) {
    console.log(w.id + ' | ' + w.region + ' | ' + w.company + ' | ' + w.name + ' | ' + (w.department || '-') + ' | ' + w.sort_order);
  }

  process.exit(0);
}

fix().catch(err => { console.error(err); process.exit(1); });
