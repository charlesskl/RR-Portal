import type { Order } from '../types/order'
export interface PatrolFact { id: string; factory: string; check_date: string; grade?: string; correction?: string; planned_date?: string; completed_date?: string }
export interface AnalysisIssue { key: string; factory: string; kind: 'correction' | 'grade' | 'delivery'; level: 'high' | 'medium'; title: string; evidence: string; suggestion: string; date: string; source: string; sourceDate?: string }
export function chinaToday(now = new Date()) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now) }
function day(value?: string) {
  const d = (value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d ? d : ''
}
const days = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86400000)
export function analyze(patrols: PatrolFact[], orders: Order[], today: string): { issues: AnalysisIssue[]; missingPatrolDates: number; missingOrderDates: number } {
  const issues: AnalysisIssue[] = []
  let missingPatrolDates = 0, missingOrderDates = 0
  const histories = new Map<string, PatrolFact[]>()
  for (const p of patrols) {
    const checked = day(p.check_date)
    if (!checked || checked > today) continue
    const list = histories.get(p.factory) || []; list.push(p); histories.set(p.factory, list)
    if (!p.correction?.trim() || day(p.completed_date)) continue
    const planned = day(p.planned_date)
    if (!planned) { missingPatrolDates++; continue }
    if (planned >= today) continue
    issues.push({ key: `correction:${p.id}:${planned}`, factory: p.factory, kind: 'correction', level: days(planned, today) >= 7 ? 'high' : 'medium', title: '整改到期未登记完成', evidence: `${checked}巡查：${p.correction}；计划${planned}完成，已逾期${days(planned, today)}天，尚无有效完成日期。`, suggestion: '核实整改实际进度；已完成的请在原巡查中补充完成日期。', date: planned, source: p.id, sourceDate: checked })
  }
  for (const [factory, list] of histories) {
    list.sort((a, b) => a.check_date.localeCompare(b.check_date) || a.id.localeCompare(b.id))
    const current = list.at(-1), previous = list.at(-2)
    if (!current || !previous || !/^[ABCD]$/.test(current.grade || '') || !/^[ABCD]$/.test(previous.grade || '')) continue
    if (current.grade! <= previous.grade!) continue
    issues.push({ key: `grade:${previous.id}:${previous.grade}:${current.id}:${current.grade}`, factory, kind: 'grade', level: current.grade === 'D' ? 'high' : 'medium', title: '最近两次巡查评级下降', evidence: `${day(previous.check_date)}评级${previous.grade} → ${day(current.check_date)}评级${current.grade}。`, suggestion: '对比两次巡查的问题和整改记录，安排重点复查。', date: day(current.check_date), source: current.id, sourceDate: day(current.check_date) })
  }
  for (const o of orders) {
    if (['delivered', 'cancelled', 'returned'].includes(o.status || '') || day(o.actual_delivery_date)) continue
    const due = day(o.delivery_date)
    if (!due) { missingOrderDates++; continue }
    if (due >= today) continue
    issues.push({ key: `delivery:${o.id}:${due}`, factory: o.factory, kind: 'delivery', level: days(due, today) >= 7 ? 'high' : 'medium', title: '订单交期已过，未登记交付', evidence: `订单${o.order_no || o.id}（${o.product || '未填产品'}），约定${due}交付，已逾期${days(due, today)}天。`, suggestion: '联系负责人核实交付进度、延期原因及新交期；已交付的更新原订单。', date: due, source: o.id })
  }
  issues.sort((a, b) => Number(b.level === 'high') - Number(a.level === 'high') || a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  return { issues, missingPatrolDates, missingOrderDates }
}
