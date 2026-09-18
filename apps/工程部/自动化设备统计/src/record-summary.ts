export type SummaryRecord = {
  id: number; factory: string; workshop: string; equipment: string;
  date: string; production: number; line: string; operator: string; note: string;
};
export function summarizeRecords<T extends SummaryRecord>(records: T[]) {
  const groups = new Map<string, { key: string; factory: string; equipment: string; date: string; production: number; records: T[] }>();
  for (const record of records) {
    const key = JSON.stringify([record.factory, record.equipment, record.date]);
    let group = groups.get(key);
    if (!group) {
      group = { key, factory: record.factory, equipment: record.equipment, date: record.date, production: 0, records: [] };
      groups.set(key, group);
    }
    group.production += record.production;
    group.records.push(record);
  }
  return [...groups.values()].sort((a, b) => a.factory.localeCompare(b.factory, 'zh-CN') || a.equipment.localeCompare(b.equipment, 'zh-CN') || b.date.localeCompare(a.date));
}
