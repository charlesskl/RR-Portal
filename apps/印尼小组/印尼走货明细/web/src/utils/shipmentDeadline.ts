// 国务院办公厅 2026 年放假安排（含调休放假区间）：
// https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
const holidays2026 = [
  ['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'],
  ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'], ['10-01', '10-07'],
]

/** 客户规则：普通周六可装运，周日（含调休上班的周日）和放假日不可用。 */
export function shipmentDeadline(cutoff: string, calendars?: Map<number, Set<string>>): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw new Error('截关日期格式不正确')
  const date = new Date(`${cutoff}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== cutoff) {
    throw new Error('截关日期格式不正确')
  }
  if (!calendars && date.getUTCFullYear() !== 2026) throw new Error('当前节假日日历仅支持2026年，请更新对应年份日历后导出')
  do {
    date.setUTCDate(date.getUTCDate() - 1)
  } while (date.getUTCDay() === 0 || (calendars ? isHoliday(date, calendars) : date.getUTCFullYear() === 2026 && holidays2026.some(([start, end]) => {
    const day = date.toISOString().slice(5, 10)
    return day >= start && day <= end
  })))
  return formatDeadline(date)
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function formatDeadline(date: Date): string {
  const month = months[date.getUTCMonth()]
  return `BEFORE ${month}.${date.getUTCDate()},${date.getUTCFullYear()}`
}

/** 交货日期固定为已计算装运期之前七个自然日，不再做工作日调整。 */
export function deliveryDeadline(shipment: string): string {
  if (!shipment) return ''
  const match = /^BEFORE ([A-Za-z]+)\.(\d{1,2}),(\d{4})$/.exec(shipment)
  if (!match || !months.includes(match[1])) throw new Error('装运期格式不正确')
  const date = new Date(Date.UTC(Number(match[3]), months.indexOf(match[1]), Number(match[2])))
  date.setUTCDate(date.getUTCDate() - 7)
  return formatDeadline(date)
}

function isHoliday(date: Date, calendars: Map<number, Set<string>>) {
  const days = calendars.get(date.getUTCFullYear())
  if (!days) throw new Error(`${date.getUTCFullYear()}年节假日日历尚未取得，请联网后重试`)
  return days.has(date.toISOString().slice(0, 10))
}

type Calendar = { year: number; papers: string[]; days: { name: string; date: string; isOffDay: boolean }[] }
function validate(value: unknown, year: number): Calendar {
  const c = value as Calendar
  if (!c || c.year !== year || !Array.isArray(c.papers) || !c.papers.length ||
    !c.papers.every(url => typeof url === 'string' && /^https?:\/\/([\w-]+\.)*gov\.cn\//.test(url)) ||
    !Array.isArray(c.days) || !c.days.length || !c.days.every(day =>
      typeof day.name === 'string' && typeof day.isOffDay === 'boolean' &&
      typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
      !Number.isNaN(Date.parse(day.date)) && new Date(day.date).toISOString().slice(0, 10) === day.date) ||
    !['元旦', '春节', '清明', '劳动', '端午', '中秋', '国庆'].every(name =>
      c.days.some(day => day.isOffDay && day.name.includes(name)))) {
    throw new Error('节假日日历未公布或数据不完整')
  }
  return c
}

// 第三方开源数据按国务院公告更新；仅请求年份，不发送走货资料。
// 每次导出检查缓存，成功同步后 24 小时内复用；失败不覆盖旧日历。
export async function loadHolidayCalendar(year: number): Promise<Set<string>> {
  const key = `indo-holidays-v1-${year}`
  let cached: { updatedAt: number; calendar: Calendar } | undefined
  try {
    const entry = JSON.parse(localStorage.getItem(key) || 'null')
    if (entry && typeof entry.updatedAt === 'number') cached = { updatedAt: entry.updatedAt, calendar: validate(entry.calendar, year) }
  } catch { /* 缓存损坏或浏览器禁止存储时继续联网。 */ }
  const dates = (c: Calendar) => new Set(c.days.filter(day => day.isOffDay).map(day => day.date))
  if (cached && Date.now() >= cached.updatedAt && Date.now() - cached.updatedAt < 86400000) return dates(cached.calendar)
  for (const base of ['https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/', 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/']) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(`${base}${year}.json`, { signal: controller.signal, cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error('同步失败')
      const calendar = validate(await response.json(), year)
      try { localStorage.setItem(key, JSON.stringify({ updatedAt: Date.now(), calendar })) } catch { /* 存储受限不影响本次导出。 */ }
      return dates(calendar)
    } catch { /* 尝试备用来源。 */ } finally { clearTimeout(timeout) }
  }
  if (cached) return dates(cached.calendar)
  if (year === 2026) {
    const days = new Set<string>()
    for (const [start, end] of holidays2026) {
      const date = new Date(`2026-${start}T00:00:00Z`)
      while (date.toISOString().slice(5, 10) <= end) {
        days.add(date.toISOString().slice(0, 10))
        date.setUTCDate(date.getUTCDate() + 1)
      }
    }
    return days
  }
  throw new Error(`${year}年节假日日历尚未公布或同步失败，请联网后重试`)
}

export async function syncedShipmentDeadline(cutoff: string): Promise<string> {
  const date = new Date(`${cutoff}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== cutoff) throw new Error('截关日期格式不正确')
  const year = date.getUTCFullYear()
  const calendars = new Map<number, Set<string>>([[year, await loadHolidayCalendar(year)]])
  // 一月回溯可能跨年，必须取得上一年日历，不能把未知日期当工作日。
  if (date.getUTCMonth() === 0) {
    const previous = await loadHolidayCalendar(year - 1)
    for (const day of calendars.get(year)!) if (day.startsWith(`${year - 1}-`)) previous.add(day)
    calendars.set(year - 1, previous)
  }
  return shipmentDeadline(cutoff, calendars)
}
