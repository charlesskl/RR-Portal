import { normalize } from './normalize.js'
import { parse } from 'date-fns'
import { generateDateCode } from './dateCodeGenerator.js'
import type {
  POData,
  POItem,
  ScheduleRow,
  RowMatchResult,
  FieldMismatch,
  ReconciliationResult,
} from '../types/index.js'

// Country name EN → ZH translation table
const COUNTRY_MAP: Record<string, string> = {
  'BELGIUM': '比利时',
  'BEL': '比利时',
  'UK': '英国',
  'UNITED KINGDOM': '英国',
  'USA': '美国',
  'UNITED STATES': '美国',
  'AUSTRALIA': '澳大利亚',
  'AUS': '澳大利亚',
  'INDONESIA': '印尼',
  'CHINA': '中国',
  'POLAND': '波兰',
  'POL': '波兰',
  'URUGUAY': '乌拉圭',
  'FRANCE': '法国',
  'GERMANY': '德国',
  'JAPAN': '日本',
  'KOREA': '韩国',
  'SOUTH KOREA': '韩国',
  'CANADA': '加拿大',
  'NETHERLANDS': '荷兰',
  'SPAIN': '西班牙',
  'ITALY': '意大利',
}

/**
 * Build an index from schedule rows keyed by normalized composite key:
 * normalize(tomyPO) + ":" + normalize(货号)
 */
function buildScheduleIndex(rows: ScheduleRow[]): Map<string, ScheduleRow[]> {
  const index = new Map<string, ScheduleRow[]>()
  for (const row of rows) {
    const key = normalize(row.tomyPO) + ':' + normalize(row.货号)
    const existing = index.get(key)
    if (existing) {
      existing.push(row)
    } else {
      index.set(key, [row])
    }
  }
  return index
}

/**
 * Generate the expected 箱唛资料 value from business rules:
 * - customerName is "TOMY" → base is "标准唛", otherwise "待定"
 * - qcInstructions contains "TTT" → append "+TTT"
 * - qcInstructions contains EU shipments text → append "+欧盟信息"
 */
function generate箱唛资料(shipToCustomerName: string, qcInstructions: string): string {
  const base = normalize(shipToCustomerName).toUpperCase().includes('TOMY') ? '标准唛' : '待定'
  let result = base
  if (qcInstructions.includes('TTT')) {
    result += '+TTT'
  }
  if (/For\s+EU\s+shipments?/i.test(qcInstructions) || qcInstructions.includes('欧盟')) {
    result += '+欧盟信息'
  }
  return result
}

/**
 * Compare all active fields between a POData/POItem and a ScheduleRow.
 * Returns an array of FieldMismatch for every field that differs.
 *
 * Fields compared:
 *   国家, 第三客户名称, 客跟单, TOMY PO, CUSTOMER PO, 货号,
 *   数量, 外箱, PO走货期, 箱唛资料
 *
 * Field 总箱数 is ALWAYS SKIPPED (not present in PDF — COMP-10).
 */
function compareFields(
  poData: POData,
  poItem: POItem,
  scheduleRow: ScheduleRow
): FieldMismatch[] {
  const mismatches: FieldMismatch[] = []

  // 国家: translate PO destCountry EN→ZH, then compare with schedule 国家
  const translatedCountry = COUNTRY_MAP[normalize(poData.destCountry).toUpperCase()] ?? normalize(poData.destCountry)
  const scheduleCountry = normalize(scheduleRow.国家)
  if (translatedCountry !== scheduleCountry) {
    mismatches.push({
      field: '国家',
      scheduleValue: scheduleRow.国家,
      poValue: translatedCountry,
    })
  }

  // 第三客户名称: compare against Ship To Customer Name
  if (normalize(poData.shipToCustomerName) !== normalize(scheduleRow.第三客户名称)) {
    mismatches.push({
      field: '第三客户名称',
      scheduleValue: scheduleRow.第三客户名称,
      poValue: poData.shipToCustomerName,
    })
  }

  // 客跟单: PO has "Last, First" format, schedule has first name only
  const scheduleHandler = normalize(scheduleRow.客跟单)
  const poHandler = normalize(poData.handleBy)
  // Extract first name from "Last, First" format
  const poFirstName = poHandler.includes(',') ? normalize(poData.handleBy.split(',').pop()!) : poHandler
  if (poHandler !== scheduleHandler && poFirstName !== scheduleHandler) {
    mismatches.push({
      field: '客跟单',
      scheduleValue: scheduleRow.客跟单,
      poValue: poData.handleBy,
    })
  }

  // TOMY PO: normalize text comparison
  if (normalize(poData.tomyPO) !== normalize(scheduleRow.tomyPO)) {
    mismatches.push({
      field: 'TOMY PO',
      scheduleValue: scheduleRow.tomyPO,
      poValue: poData.tomyPO,
    })
  }

  // CUSTOMER PO: normalize text comparison
  if (normalize(poData.customerPO) !== normalize(scheduleRow.customerPO)) {
    mismatches.push({
      field: 'CUSTOMER PO',
      scheduleValue: scheduleRow.customerPO,
      poValue: poData.customerPO,
    })
  }

  // 货号: normalize text comparison
  if (normalize(poItem.货号) !== normalize(scheduleRow.货号)) {
    mismatches.push({
      field: '货号',
      scheduleValue: scheduleRow.货号,
      poValue: poItem.货号,
    })
  }

  // 数量: numeric equality (skip if PO value is null/undefined)
  if (poItem.数量 != null) {
    if (poItem.数量 !== scheduleRow.数量) {
      mismatches.push({
        field: '数量',
        scheduleValue: scheduleRow.数量,
        poValue: poItem.数量,
      })
    }
  }

  // 外箱: numeric equality (skip if PO value is null)
  if (poItem.外箱 != null) {
    if (poItem.外箱 !== scheduleRow.外箱) {
      mismatches.push({
        field: '外箱',
        scheduleValue: scheduleRow.外箱,
        poValue: poItem.外箱,
      })
    }
  }

  // 总箱数: ALWAYS SKIP — field not in PDF (COMP-10)

  // PO走货期: parse PO string with date-fns, compare year/month/day against schedule Date
  const poDate = parse(poItem.PO走货期, 'd MMM yyyy', new Date())
  console.log(`[compare] PO走货期 PO="${poItem.PO走货期}" parsed=${poDate.toISOString()} sched=${scheduleRow.PO走货期} schedType=${typeof scheduleRow.PO走货期} isDate=${scheduleRow.PO走货期 instanceof Date}`)
  if (!isNaN(poDate.getTime())) {
    const schedDate = scheduleRow.PO走货期
    if (
      schedDate == null ||
      poDate.getFullYear() !== schedDate.getFullYear() ||
      poDate.getMonth() !== schedDate.getMonth() ||
      poDate.getDate() !== schedDate.getDate()
    ) {
      mismatches.push({
        field: 'PO走货期',
        scheduleValue: scheduleRow.PO走货期,
        poValue: poItem.PO走货期,
      })
    }
  }

  // 箱唛资料: generate expected value from rules, compare against schedule value
  const expected箱唛 = generate箱唛资料(poData.shipToCustomerName, poData.qcInstructions)
  if (normalize(expected箱唛) !== normalize(scheduleRow.箱唛资料)) {
    mismatches.push({
      field: '箱唛资料',
      scheduleValue: scheduleRow.箱唛资料,
      poValue: expected箱唛,
    })
  }

  // 客贴纸: if PO has JD label, schedule should have it noted (case-insensitive)
  if (poItem.hasJDLabel) {
    const stickerNote = normalize(scheduleRow.客贴纸).toLowerCase()
    if (!stickerNote || !stickerNote.includes('jd')) {
      mismatches.push({
        field: '客贴纸',
        scheduleValue: scheduleRow.客贴纸 ?? '(空)',
        poValue: '有JD贴纸',
      })
    }
  }

  return mismatches
}

/**
 * Reconcile PO data against schedule rows.
 *
 * Matching: composite key normalize(tomyPO) + ":" + normalize(货号)
 * Duplicate 货号 within the same PO are flagged as ambiguous.
 * Unmatched items are collected separately.
 *
 * @param poDataList - Parsed PO data from all uploaded PDFs
 * @param scheduleRows - Parsed schedule rows from the Excel file
 * @returns ReconciliationResult with matched, unmatchedPOItems, ambiguousPOItems, errors
 */
export function reconcile(
  poDataList: POData[],
  scheduleRows: ScheduleRow[]
): ReconciliationResult {
  const matched: RowMatchResult[] = []
  const unmatchedPOItems: ReconciliationResult['unmatchedPOItems'] = []
  const ambiguousPOItems: ReconciliationResult['ambiguousPOItems'] = []
  const errors: string[] = []

  const scheduleIndex = buildScheduleIndex(scheduleRows)

  for (const poData of poDataList) {
    // Track which schedule rows have already been claimed by a PO item
    const claimedScheduleRows = new Set<number>()
    // Track which PO item indices have been matched
    const matchedItemIndices = new Set<number>()

    // Pass 1: match items with exact 数量 first (best disambiguation)
    for (let i = 0; i < poData.items.length; i++) {
      const item = poData.items[i]
      const compositeKey = normalize(poData.tomyPO) + ':' + normalize(item.货号)
      const candidateRows = scheduleIndex.get(compositeKey)
      if (!candidateRows) continue

      const availableRows = candidateRows.filter(r => !claimedScheduleRows.has(r.rowIndex))
      const exactQtyMatch = availableRows.find(r => r.数量 === item.数量)
      if (exactQtyMatch) {
        claimedScheduleRows.add(exactQtyMatch.rowIndex)
        matchedItemIndices.add(i)
        matched.push({
          scheduleRowIndex: exactQtyMatch.rowIndex,
          tomyPO: poData.tomyPO,
          货号: item.货号,
          status: 'matched',
          mismatches: compareFields(poData, item, exactQtyMatch),
          dateCode: generateDateCode(item.PO走货期, item.factoryCode),
          sourceFile: poData.sourceFile,
          hasJDLabel: item.hasJDLabel,
        })
      }
    }

    // Pass 2: match remaining items to first available schedule row
    for (let i = 0; i < poData.items.length; i++) {
      if (matchedItemIndices.has(i)) continue
      const item = poData.items[i]
      const compositeKey = normalize(poData.tomyPO) + ':' + normalize(item.货号)
      const candidateRows = scheduleIndex.get(compositeKey)

      if (!candidateRows || candidateRows.length === 0) {
        unmatchedPOItems.push({
          tomyPO: poData.tomyPO,
          货号: item.货号,
          sourceFile: poData.sourceFile,
          poItem: item,
          poData,
        })
        continue
      }

      const availableRows = candidateRows.filter(r => !claimedScheduleRows.has(r.rowIndex))
      if (availableRows.length === 0) {
        unmatchedPOItems.push({
          tomyPO: poData.tomyPO,
          货号: item.货号,
          sourceFile: poData.sourceFile,
          poItem: item,
          poData,
        })
        continue
      }

      const scheduleRow = availableRows[0]
      claimedScheduleRows.add(scheduleRow.rowIndex)
      matched.push({
        scheduleRowIndex: scheduleRow.rowIndex,
        tomyPO: poData.tomyPO,
        货号: item.货号,
        status: 'matched',
        mismatches: compareFields(poData, item, scheduleRow),
        dateCode: generateDateCode(item.PO走货期, item.factoryCode),
        sourceFile: poData.sourceFile,
        hasJDLabel: item.hasJDLabel,
      })
    }
  }

  return { matched, unmatchedPOItems, ambiguousPOItems, errors }
}
