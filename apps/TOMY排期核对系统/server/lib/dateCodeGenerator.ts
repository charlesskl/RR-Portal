import pkg from 'chinese-days'
const { isWorkday, findWorkday } = pkg
import { subMonths, parse, format } from 'date-fns'

const MONTH_LETTERS = 'ABCDEFGHIJKL'

/**
 * Generates a production date code for a PO item.
 *
 * Algorithm:
 * 1. Validate factoryCode matches RR01 or RR02; return null otherwise
 * 2. Parse the PO走货期 string (e.g., "15 May 2026") using date-fns
 * 3. Subtract one calendar month (subMonths handles end-of-month clamping)
 * 4. Roll back to nearest prior workday if date falls on weekend/public holiday
 * 5. Format as: monthLetter + day + 2-digit-year + factoryCode
 *
 * @param poZouHuoQiStr - PO走货期 string in "d MMM yyyy" format, e.g. "15 May 2026"
 * @param factoryCode - Factory code, must be "RR01" or "RR02"
 * @returns Date code string (e.g., "D1526RR02") or null if inputs are invalid
 */
export function generateDateCode(
  poZouHuoQiStr: string,
  factoryCode: string
): string | null {
  // Validate factory code — only RR01 and RR02 are recognized
  if (!factoryCode.match(/^RR0[12]$/)) return null

  // Parse date string — return null for empty or unparseable input
  if (!poZouHuoQiStr) return null
  const poDate = parse(poZouHuoQiStr, 'd MMM yyyy', new Date())
  if (isNaN(poDate.getTime())) return null

  // Subtract one calendar month (date-fns clamps end-of-month: Mar 31 → Feb 28)
  const minus1 = subMonths(poDate, 1)
  const dateStr = format(minus1, 'yyyy-MM-dd')

  // Roll back to nearest prior workday if date is not a workday
  // IMPORTANT: findWorkday(-1, x) is exclusive — check isWorkday first
  const workdayStr = isWorkday(dateStr) ? dateStr : findWorkday(-1, dateStr)
  const workday = parse(workdayStr, 'yyyy-MM-dd', new Date())

  // Build date code: monthLetter + day + 2-digit-year + factoryCode
  const letter = MONTH_LETTERS[workday.getMonth()]
  const day = workday.getDate()
  const year = String(workday.getFullYear()).slice(2)
  return `${letter}${day}${year}${factoryCode}`
}
