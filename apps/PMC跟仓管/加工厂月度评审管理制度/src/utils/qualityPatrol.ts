export const PATROL_GRADES = ['A', 'B', 'C', 'D'] as const
export const PATROL_GUIDANCE = 'A：可增加合作订单。B：现有问题整改完成后，可增加合作订单。C：现有问题整改完成，维持订单现状。D：有计划的减少订单，直至停止合作。'
export const PATROL_FIELDS = [
  { key: 'staff', label: '员工人数', type: 'number' },
  { key: 'lines', label: '拉线', type: 'number' },
  { key: 'area', label: '场地面积（平方）', type: 'number' },
  { key: 'responsibility_scope', label: '责任范围', type: 'short' },
  { key: 'responsible_supervisor', label: '责任主管', type: 'short' },
  { key: 'processing_fee_period', label: '加工费统计期间', type: 'short' },
  { key: 'processing_fee', label: '加工费（万）', type: 'number' },
  { key: 'grade', label: '本次评级', type: 'grade' },
  { key: 'evaluation', label: '评价', type: 'text' },
  { key: 'correction', label: '整改描述', type: 'text' },
  { key: 'planned_date', label: '计划完成时间', type: 'date' },
  { key: 'completed_date', label: '整改完成时间', type: 'date' },
  { key: 'completion_details', label: '整改完成说明（原文）', type: 'text' },
  { key: 'production_type', label: '符合生产类型', type: 'text' },
  { key: 'notes', label: '备注', type: 'text' },
] as const
// The report follows template 02; older planned dates remain editable/comparable.
export const PATROL_TABLE_FIELDS = PATROL_FIELDS.filter(f => !['notes', 'planned_date', 'processing_fee_period', 'completion_details'].includes(f.key))
export function patrolDisplayValue(record: Record<string, any>, key: string) {
  if (key === 'completed_date' && record.completion_details) return record.completion_details
  if (key.endsWith('_date')) return record[key]?.slice(0, 10) || '—'
  return record[key] === '' || record[key] == null ? '—' : record[key]
}
export function patrolSummary(rows: { grade?: string; staff?: unknown; factory?: string }[]) {
  return {
    factories: new Set(rows.map(r => r.factory).filter(Boolean)).size,
    staff: rows.reduce((sum, r) => sum + (Number(r.staff) || 0), 0),
    grades: PATROL_GRADES.map(grade => {
      const count = rows.filter(r => r.grade === grade).length
      return { grade, count, percent: rows.length ? (count / rows.length * 100).toFixed(2) + '%' : '—' }
    }),
    unrated: rows.filter(r => !PATROL_GRADES.includes(r.grade as typeof PATROL_GRADES[number])).length,
  }
}
