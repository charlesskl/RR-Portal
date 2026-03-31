const { calculateRecord } = require('../modules/balance/calc');

describe('calculateRecord', () => {
  test('beer: balance = output - all expenses', async () => {
    const r = await calculateRecord('beer', {
      daily_output: 50000,
      worker_wage: 6000, supervisor_wage: 2000, rent: 900, utility_fee: 7000,
      tool_investment: 0, equipment: 0, renovation: 0, misc_fee: 0,
      shipping_fee: 0, social_insurance: 263, tax: 809,
      misc_worker_wage: 3960, machine_repair: 1500, mold_repair: 1500,
      gate_processing_fee: 2750, assembly_gate_parts_fee: 0,
      recoverable_gate_fee: 0, material_supplement: 0,
      total_machines: 42, running_machines: 30
    });
    expect(r.balance).toBeCloseTo(50000 - 6000 - 2000 - 900 - 7000 - 263 - 809 - 3960 - 1500 - 1500 - 2750, 1);
    expect(r.balance_ratio).toBeCloseTo(r.balance / 50000, 4);
    expect(r.machine_rate).toBeCloseTo(30 / 42, 4);
  });

  test('assembly: balance_minus_tape', async () => {
    const r = await calculateRecord('assembly', {
      daily_output: 100000,
      worker_wage: 0, supervisor_wage: 10000, rent: 800, utility_fee: 1000,
      tool_investment: 900, equipment: 0, renovation: 0, misc_fee: 0,
      shipping_fee: 0, social_insurance: 900, tax: 1200,
      actual_wage: 20000, workshop_repair: 0, electrical_repair: 0,
      workshop_materials: 0, stretch_film: 0, supplement: 0,
      housing_subsidy: 0, tape: 300, borrowed_worker_wage: 0,
      planned_wage_tax: 30000, worker_count: 100
    });
    expect(r.balance_minus_tape).toBeCloseTo(r.balance - 300, 1);
    expect(r.avg_output_per_worker).toBeCloseTo(1000, 1);
  });

  test('print: pad and spray machine rates', async () => {
    const r = await calculateRecord('print', {
      daily_output: 80000,
      worker_wage: 5000, supervisor_wage: 2000, rent: 500, utility_fee: 800,
      tool_investment: 0, equipment: 0, renovation: 0, misc_fee: 0,
      shipping_fee: 0, social_insurance: 400, tax: 600,
      pad_total_machines: 20, pad_running_machines: 15,
      spray_total_machines: 10, spray_running_machines: 8,
      subsidy: 0, materials: 0, repair_fee: 0, oil_water_amount: 0,
      no_output_wage: 0, non_recoverable_tool_fee: 0,
      assembly_wage_paid: 0, office_wage: 1000,
      auto_mold_fee: 500, hunan_mold_fee: 0, indonesia_mold_fee: 0,
      worker_count: 50
    });
    expect(r.pad_machine_rate).toBeCloseTo(15 / 20, 4);
    expect(r.spray_machine_rate).toBeCloseTo(8 / 10, 4);
    expect(r.avg_output_per_worker).toBeCloseTo(80000 / 50, 1);
  });
});
