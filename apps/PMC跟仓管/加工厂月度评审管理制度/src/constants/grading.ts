export type Grade = 'A' | 'B' | 'C' | 'D'
// 评级线（满分100）：>=90 A正常, 70-89 B正常, 50-69 C限单, <50 D暂停/淘汰评审
export const GRADE_THRESHOLDS: { min: number; grade: Grade }[] = [
  { min: 90, grade: 'A' },
  { min: 70, grade: 'B' },
  { min: 50, grade: 'C' },
  { min: 0, grade: 'D' },
]
// 红牌触发的异常类型
export const RED_FLAG_INCIDENTS = ['batch_defect', 'env_violation', 'shutdown']
