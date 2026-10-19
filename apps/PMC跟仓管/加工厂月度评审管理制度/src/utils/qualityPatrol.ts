export const PATROL_GRADES = ['A', 'B', 'C', 'D'] as const
export const PATROL_GUIDANCE = 'A：可增加合作订单。B：现有问题整改完成后，可增加合作订单。C：现有问题整改完成，维持订单现状。D：有计划的减少订单，直至停止合作。'
export const PATROL_FIELDS = [
  { key: 'staff', label: '员工人数', type: 'number' },
  { key: 'lines', label: '拉线', type: 'number' },
  { key: 'area', label: '场地面积（平方）', type: 'number' },
  { key: 'previous_date', label: '上次评级日期', type: 'date' },
  { key: 'previous_grade', label: '上次评级', type: 'grade' },
  { key: 'grade', label: '本次评级', type: 'grade' },
  { key: 'previous_evaluation', label: '上次评价', type: 'text' },
  { key: 'previous_correction', label: '上次整改描述', type: 'text' },
  { key: 'planned_date', label: '计划完成时间', type: 'date' },
  { key: 'previous_type', label: '符合类型（上次）', type: 'text' },
  { key: 'evaluation', label: '本次评价', type: 'text' },
  { key: 'correction', label: '本次整改描述', type: 'text' },
  { key: 'completed_date', label: '整改完成时间', type: 'date' },
  { key: 'production_type', label: '符合生产类型', type: 'text' },
  { key: 'notes', label: '备注', type: 'text' },
] as const
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
