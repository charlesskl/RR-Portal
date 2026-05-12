// 收支表列定义。每列标注 key / label / editable / computed。
// computed 的列由 buildLedger 根据核价+分拉+手填算出;editable 的列取自 ledger_edits。
const LEDGER_COLUMNS = [
  { key: 'date',                   label: '日期',                  computed: true },
  { key: 'line_name',              label: '拉名',                  computed: true },
  { key: 'machine_total',          label: '机台数',                editable: true },
  { key: 'machine_on',             label: '每天开机数',            editable: true },
  { key: 'machine_rate',           label: '开机率',                computed: true },
  { key: 'foreman_count',          label: '管工人数',              editable: true },
  { key: 'helper_count',           label: '杂工',                  editable: true },
  { key: 'employee_count',         label: '员工人数(不含杂工)',   editable: true },
  { key: 'work_hours',             label: '工时',                  computed: true },
  { key: 'total_time',             label: '总时间',                computed: true },
  { key: 'total_output',           label: '总产值/天',             computed: true },
  { key: 'per_employee_output',    label: '员工人均产值',          computed: true },
  { key: 'worker_wage_total',      label: '员工总工资',            computed: true },
  { key: 'foreman_wage',           label: '管工工资',              editable: true },
  { key: 'wage_pct_of_output',     label: '总工资占产值%',         computed: true },
  { key: 'equipment_invest',       label: '设备投资',              editable: true },
  { key: 'tool_unrecoverable',     label: '不可回收工具费',        editable: true },
  { key: 'tool_recoverable',       label: '可收回工具费',          editable: true },
  { key: 'rent',                   label: '房租/26天算',           editable: true },
  { key: 'utilities',              label: '水电费',                editable: true },
  { key: 'material',               label: '物料(原子灰/胶头/油墨/溶剂)', editable: true },
  { key: 'misc',                   label: '杂费(口罩/手套)',      editable: true },
  { key: 'maintenance',            label: '维修费',                editable: true },
  { key: 'subsidy',                label: '补贴',                  editable: true },
  { key: 'actual_material_cost',   label: '实际用原料金额',        editable: true },
  { key: 'no_output_wage',         label: '无产值工资',            editable: true },
  { key: 'recoverable_wage',       label: '可收回工资',            editable: true },
  { key: 'indonesia_wage',         label: '可收回印尼工资/0.88',   editable: true },
  { key: 'recoverable_paint',      label: '可回收油漆金额',        editable: true },
  { key: 'processing_fee',         label: '加工费',                editable: true },
  { key: 'balance',                label: '结余金额',              computed: true },
  { key: 'balance_pct',            label: '结余%',                 computed: true },
];

const WORK_HOURS = 11;
const EDITABLE_COST_KEYS = [
  'equipment_invest', 'tool_unrecoverable', 'tool_recoverable', 'rent', 'utilities',
  'material', 'misc', 'maintenance', 'actual_material_cost', 'no_output_wage',
  'recoverable_wage', 'indonesia_wage', 'recoverable_paint', 'processing_fee',
  'foreman_wage',
];

function num(v) { return Number(v) || 0; }
function round2(v) { return Math.round(v * 100) / 100; }

function buildLedger(db, date, workshop_id) {
  const products = db.prepare(`
    SELECT DISTINCT p.id, p.code, p.name, p.quote_price
    FROM daily_records dr JOIN products p ON p.id = dr.product_id
    WHERE dr.record_date = ? AND dr.workshop_id = ?
    ORDER BY p.id
  `).all(date, workshop_id);

  const lines = db.prepare('SELECT * FROM lines WHERE workshop_id=? ORDER BY sort_order').all(workshop_id);

  const aggStmt = db.prepare(`
    SELECT
      COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS total_output,
      COALESCE(SUM(dr.produced_qty * pp.unit_wage), 0) AS worker_wage_total
    FROM daily_records dr
    JOIN products p ON p.id = dr.product_id
    JOIN product_processes pp ON pp.id = dr.product_process_id
    WHERE dr.record_date = ? AND dr.product_id = ? AND dr.line_id = ? AND dr.workshop_id = ?
  `);

  const edits = db.prepare('SELECT * FROM ledger_edits WHERE ledger_date = ? AND workshop_id = ?').all(date, workshop_id);
  const editMap = new Map();
  for (const e of edits) {
    const k = `${e.line_id}|${e.product_id || 0}|${e.column_key}`;
    editMap.set(k, e.value);
  }
  const getEdit = (lineId, productId, columnKey) =>
    editMap.get(`${lineId}|${productId || 0}|${columnKey}`);

  const rows = [];
  for (const prod of products) {
    for (const line of lines) {
      const agg = aggStmt.get(date, prod.id, line.id, workshop_id);
      const emp = num(getEdit(line.id, prod.id, 'employee_count'));
      const machineTotal = num(getEdit(line.id, prod.id, 'machine_total'));
      const machineOn = num(getEdit(line.id, prod.id, 'machine_on'));
      const totalOutput = round2(agg.total_output);
      const workerWageTotal = round2(agg.worker_wage_total);
      const totalTime = emp * WORK_HOURS;
      const perEmp = emp > 0 ? round2(totalOutput / emp) : 0;
      const machineRate = machineTotal > 0 ? round2(machineOn / machineTotal) : 0;
      const wagePct = totalOutput > 0 ? round2(workerWageTotal / totalOutput) : 0;
      const costSum = EDITABLE_COST_KEYS.reduce(
        (s, k) => s + num(getEdit(line.id, prod.id, k)), 0
      );
      const balance = round2(totalOutput - workerWageTotal - costSum);
      const balancePct = totalOutput > 0 ? round2(balance / totalOutput) : 0;

      const values = {
        date,
        line_name: line.name,
        machine_total: getEdit(line.id, prod.id, 'machine_total') || '',
        machine_on: getEdit(line.id, prod.id, 'machine_on') || '',
        machine_rate: machineRate,
        foreman_count: getEdit(line.id, prod.id, 'foreman_count') || '',
        helper_count: getEdit(line.id, prod.id, 'helper_count') || '',
        employee_count: getEdit(line.id, prod.id, 'employee_count') || '',
        work_hours: WORK_HOURS,
        total_time: totalTime,
        total_output: totalOutput,
        per_employee_output: perEmp,
        worker_wage_total: workerWageTotal,
        foreman_wage: getEdit(line.id, prod.id, 'foreman_wage') || '',
        wage_pct_of_output: wagePct,
        balance,
        balance_pct: balancePct,
      };
      for (const col of LEDGER_COLUMNS) {
        if (col.editable && values[col.key] === undefined) {
          values[col.key] = getEdit(line.id, prod.id, col.key) || '';
        }
      }
      rows.push({
        product_id: prod.id,
        product_code: prod.code,
        product_name: prod.name,
        line_id: line.id,
        line_name: line.name,
        values,
      });
    }
  }

  return { columns: LEDGER_COLUMNS, rows };
}

module.exports = { buildLedger, LEDGER_COLUMNS, WORK_HOURS };
