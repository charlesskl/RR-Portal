import { GRADE_THRESHOLDS, type Grade } from '../constants/grading'

export function gradeFromScore(total: number): Grade {
  for (const t of GRADE_THRESHOLDS) {
    if (total >= t.min) return t.grade
  }
  return 'D'
}

// 总分 = 各项 score 之和（前端镜像，与服务端 hook 保持一致）
export function totalFromItems(items: { score: number }[]): number {
  return items.reduce((sum, it) => sum + (Number(it.score) || 0), 0)
}
