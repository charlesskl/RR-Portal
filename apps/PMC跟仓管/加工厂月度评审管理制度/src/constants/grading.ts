export type Grade = 'A' | 'B' | 'C' | 'D'
// 评级线（满分100）：>=90 A正常, 80-89 B正常, 70-79 C限单, <70 D暂停/淘汰评审
export const GRADE_THRESHOLDS: { min: number; grade: Grade }[] = [
  { min: 90, grade: 'A' },
  { min: 80, grade: 'B' },
  { min: 70, grade: 'C' },
  { min: 0, grade: 'D' },
]
// 红牌触发的异常类型
export const RED_FLAG_INCIDENTS = ['batch_defect', 'env_violation', 'shutdown']
