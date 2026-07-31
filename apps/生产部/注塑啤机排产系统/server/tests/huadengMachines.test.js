const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const serverDir = path.join(__dirname, '..');
const initModule = path.join(serverDir, 'db', 'init.js');
const seedFile = path.join(serverDir, 'seed', 'machines.json');
const expectedMachineNos = Array.from({ length: 38 }, (_, i) => `C-${i + 1}#`);
const newMachineNos = expectedMachineNos.slice(34);

test('initializes Huadeng with 38 numbered machines and two special machines', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paiji-huadeng-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const initResult = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(initModule)}).initDatabase()`],
    {
      cwd: serverDir,
      env: { ...process.env, DATA_PATH: dataDir },
      encoding: 'utf8',
    }
  );
  assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);

  const db = new Database(path.join(dataDir, 'paiji.db'), { readonly: true });
  t.after(() => db.close());
  const allHuadengMachines = db.prepare(`
    SELECT machine_no, brand, tonnage, arm_type, status
    FROM machines
    WHERE workshop = 'C'
  `).all();
  const regularMachines = allHuadengMachines
    .filter((machine) => /^C-\d+#$/.test(machine.machine_no))
    .sort((a, b) => Number(a.machine_no.slice(2, -1)) - Number(b.machine_no.slice(2, -1)));

  assert.deepEqual(regularMachines.map((machine) => machine.machine_no), expectedMachineNos);
  assert.equal(allHuadengMachines.length, 40);
  assert.equal(new Set(allHuadengMachines.map((machine) => machine.machine_no)).size, 40);

  for (const machine of regularMachines.filter((item) => newMachineNos.includes(item.machine_no))) {
    assert.deepEqual(machine, {
      machine_no: machine.machine_no,
      brand: '博创',
      tonnage: 150,
      arm_type: '三轴单臂',
      status: 'active',
    });
  }
});

test('Huadeng seed data contains C-35# through C-38# with the standard attributes', () => {
  const seedMachines = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  const newSeedMachines = seedMachines
    .filter((machine) => machine.workshop === 'C' && newMachineNos.includes(machine.machine_no))
    .sort((a, b) => Number(a.machine_no.slice(2, -1)) - Number(b.machine_no.slice(2, -1)));

  assert.deepEqual(
    newSeedMachines,
    newMachineNos.map((machineNo) => ({
      machine_no: machineNo,
      brand: '博创',
      tonnage: 150,
      arm_type: '三轴单臂',
      model_desc: '博创150T三轴单臂',
      status: 'active',
      workshop: 'C',
    }))
  );
});
