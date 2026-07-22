import type { Factory } from '../types/factory'
import type { Order } from '../types/order'
import type { Quality5sCheck } from '../types/quality5s'
import type { QualityInspection } from '../types/qualityInspection'
import type { ScoreItem, ScoreModule, ScoreTemplate } from '../types/score'

const AUTO_MODULES = new Set<ScoreModule>([
  'qualification', 'delivery', 'defect_rate', 'process', '5s', 'craft_specific',
])
const S5_KEYS: (keyof Quality5sCheck)[] = [
  's_area', 's_material', 's_hygiene', 's_sharp',
  's_nonconform', 's_standard', 's_qc_staff', 's_correction',
]

const round2 = (value: number) => Math.round(value * 100) / 100
const text = (value: unknown) => String(value ?? '').trim()
const upper = (value: unknown) => text(value).toUpperCase()
const isPass = (value: unknown) => upper(value) === 'PASS'
const isReject = (value: unknown) => ['REJ', 'FAIL', 'NG', '不合格'].includes(upper(value))

export interface MonthlyScoringData {
  orders: Order[]
  inspections: QualityInspection[]
  checks: Quality5sCheck[]
}

export interface AutoScoreResult {
  score: number
  notes: string
}

export function isAutoScoreModule(module: ScoreModule): boolean {
  return AUTO_MODULES.has(module)
}

export function recordMonth(value?: string): string {
  return text(value).slice(0, 7)
}

export function orderMonth(order: Order): string {
  return recordMonth(order.delivery_date || order.actual_delivery_date || order.order_date)
}

export function filterMonthlyScoringData(data: MonthlyScoringData, month: string): MonthlyScoringData {
  return {
    orders: data.orders.filter((order) => orderMonth(order) === month),
    inspections: data.inspections.filter((item) => recordMonth(item.inspect_date) === month),
    checks: data.checks.filter((item) => recordMonth(item.check_date) === month),
  }
}

function positiveStatus(value: unknown): boolean {
  const status = text(value)
  if (!status) return false
  if (/不适用|无需|未过期|^N\/?A$/i.test(status)) return true
  if (/未|缺|过期|失效|待确认|不合格|无管控|^否$/.test(status)) return false
  return true
}

function qualificationScore(factory: Factory, maxScore: number): AutoScoreResult {
  const certOk = positiveStatus(factory.cert_status)
  const ipOk = positiveStatus(factory.ip_control)
  const half = maxScore / 2
  return {
    score: round2((certOk ? half : 0) + (ipOk ? half : 0)),
    notes: `自动评分：环评/消防/安监资质 ${text(factory.cert_status) || '未填写'}（${certOk ? round2(half) : 0}分）；IP管控 ${text(factory.ip_control) || '未填写'}（${ipOk ? round2(half) : 0}分）`,
  }
}

function uniqueOrders(orders: Order[]): Order[][] {
  const groups = new Map<string, Order[]>()
  for (const order of orders) {
    const key = text(order.order_no) || `record:${order.id}`
    const group = groups.get(key)
    if (group) group.push(order)
    else groups.set(key, [order])
  }
  return [...groups.values()]
}

function deliveryScore(orders: Order[], maxScore: number): AutoScoreResult {
  const groups = uniqueOrders(orders)
  const delayed = groups.filter((group) => group.some((order) => order.is_delayed || Number(order.delay_days) > 0)).length
  const onTime = groups.length - delayed
  const rate = groups.length ? onTime / groups.length : 0
  return {
    score: round2(rate * maxScore),
    notes: groups.length
      ? `自动评分：订单 ${groups.length} 单，准时 ${onTime} 单，延期 ${delayed} 单，准时率 ${round2(rate * 100)}%`
      : '自动评分：当月无交期订单，待确认',
  }
}

function qualityResults(inspections: QualityInspection[]) {
  const valid = inspections.filter((item) => text(item.internal_result))
  const pass = valid.filter((item) => isPass(item.internal_result)).length
  const reject = valid.filter((item) => isReject(item.internal_result)).length
  return { valid, pass, reject }
}

function defectRateScore(inspections: QualityInspection[], maxScore: number): AutoScoreResult {
  const { valid, reject } = qualityResults(inspections)
  const rejectRate = valid.length ? reject / valid.length : 0
  return {
    score: round2((valid.length ? 1 - rejectRate : 0) * maxScore),
    notes: valid.length
      ? `自动评分：检验 ${valid.length} 条，REJ ${reject} 条，REJ比例 ${round2(rejectRate * 100)}%`
      : '自动评分：当月无内部检验结果，待确认',
  }
}

function processScore(inspections: QualityInspection[], maxScore: number): AutoScoreResult {
  const { valid, pass } = qualityResults(inspections)
  const passRate = valid.length ? pass / valid.length : 0
  return {
    score: round2(passRate * maxScore),
    notes: valid.length
      ? `自动评分：内部检验 ${valid.length} 条，PASS ${pass} 条，通过率 ${round2(passRate * 100)}%`
      : '自动评分：当月无内部检验结果，待确认',
  }
}

function siteScore(checks: Quality5sCheck[], maxScore: number): AutoScoreResult {
  const latest = [...checks].sort((a, b) => text(b.check_date).localeCompare(text(a.check_date)))[0]
  if (!latest) return { score: 0, notes: '自动评分：当月无5S检查记录，待确认' }
  const raw = S5_KEYS.reduce((sum, key) => sum + (Number(latest[key]) || 0), 0)
  const rate = Math.min(Math.max(raw, 0), 100) / 100
  return {
    score: round2(rate * maxScore),
    notes: `自动评分：采用 ${text(latest.check_date).slice(0, 10)} 最新检查记录，5S得分 ${round2(raw)}/100`,
  }
}

function craftSpecificScore(data: MonthlyScoringData, maxScore: number): AutoScoreResult {
  const defect = defectRateScore(data.inspections, 15)
  const site = siteScore(data.checks, 5)
  const sourceTotal = defect.score + site.score
  const rate = sourceTotal / 20
  return {
    score: round2(rate * maxScore),
    notes: `自动评分：月度综合不良率 ${defect.score}/15 + 5S现场评分 ${site.score}/5，综合达成率 ${round2(rate * 100)}%，专项得分 ${round2(rate * maxScore)}/${maxScore}`,
  }
}

export function calculateAutoScore(
  module: ScoreModule,
  maxScore: number,
  factory: Factory,
  data: MonthlyScoringData,
): AutoScoreResult | null {
  if (module === 'qualification') return qualificationScore(factory, maxScore)
  if (module === 'delivery') return deliveryScore(data.orders, maxScore)
  if (module === 'defect_rate') return defectRateScore(data.inspections, maxScore)
  if (module === 'process') return processScore(data.inspections, maxScore)
  if (module === '5s') return siteScore(data.checks, maxScore)
  if (module === 'craft_specific') return craftSpecificScore(data, maxScore)
  return null
}

export function mergeAutomaticScores(
  templates: ScoreTemplate[],
  existingItems: ScoreItem[],
  factory: Factory,
  data: MonthlyScoringData,
): ScoreItem[] {
  const existing = new Map(existingItems.map((item) => [item.template_id, item]))
  return templates.map((template) => {
    const current = existing.get(template.id) ?? { template_id: template.id, score: 0, notes: '' }
    const automatic = calculateAutoScore(template.module, template.max_score, factory, data)
    return automatic ? { template_id: template.id, ...automatic } : current
  })
}
