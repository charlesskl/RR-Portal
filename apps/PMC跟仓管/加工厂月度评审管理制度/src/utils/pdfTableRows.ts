export type PositionedText = {
  text: string
  x: number
  y: number
  width: number
}

const REQUIRED_HEADERS = ['货号', '订单号', '物料名称']
const PURCHASE_ORDER_HEADERS = ['加工厂', '下单PMC', '货号', '订单号', '物料名称', '数量', '下单时间', '外发工价', '备注']

function normalizeCell(value: string) {
  return value.replace(/\s+/g, '')
}

function rowKey(item: PositionedText) {
  return Math.round(item.y / 3) * 3
}

function buildRows(items: PositionedText[]) {
  const groups = new Map<number, PositionedText[]>()
  for (const item of items) {
    const key = rowKey(item)
    const row = groups.get(key)
    if (row) row.push(item)
    else groups.set(key, [item])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x))
}

function mergeCloseItems(row: PositionedText[]) {
  const merged: PositionedText[] = []
  for (const item of row) {
    const prev = merged[merged.length - 1]
    if (prev && item.x - (prev.x + prev.width) < 3) {
      prev.text += item.text
      prev.width = Math.max(prev.width, item.x + item.width - prev.x)
    } else {
      merged.push({ ...item })
    }
  }
  return merged
}

function nearestColumn(x: number, columns: PositionedText[]) {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  columns.forEach((col, idx) => {
    const dist = Math.abs(x - col.x)
    if (dist < bestDist) {
      best = idx
      bestDist = dist
    }
  })
  return best
}

function cleanText(value: string) {
  return value.replace(/\s+/g, '')
}

function joinItems(items: PositionedText[]) {
  return items
    .sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('')
}

function itemsInBox(items: PositionedText[], xMin: number, xMax: number, yMin: number, yMax: number) {
  return items.filter((item) => item.x >= xMin && item.x <= xMax && item.y >= yMin && item.y <= yMax)
}

function textInBox(items: PositionedText[], xMin: number, xMax: number, yMin: number, yMax: number) {
  return joinItems(itemsInBox(items, xMin, xMax, yMin, yMax))
}

function sameRowValueAfterLabel(items: PositionedText[], label: RegExp, xMax = Number.POSITIVE_INFINITY) {
  const target = items.find((item) => label.test(cleanText(item.text)))
  if (!target) return ''
  return joinItems(items.filter((item) =>
    item !== target &&
    Math.abs(item.y - target.y) <= 4 &&
    item.x > target.x + target.width - 2 &&
    item.x <= xMax &&
    !label.test(cleanText(item.text))))
}

function formatChineseDate(value: string) {
  const match = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!match) return ''
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function numberText(value: string) {
  const text = cleanText(value)
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : ''
}

function normalizeItemNo(value: string, fileName?: string) {
  const text = cleanText(value)
  return text.match(/^\d+/)?.[0] ?? cleanText(fileName ?? '').match(/^\d+/)?.[0] ?? text
}

function purchaseOrderHeader(items: PositionedText[], fileName?: string) {
  const allText = joinItems([...items])
  const supplier = sameRowValueAfterLabel(items, /供[應应]商[:：]/, 390) || textInBox(items, 75, 260, 716, 730)
  const orderNo = allText.match(/(?:CMC|ZWZ|LLQ)\d+/i)?.[0] ?? ''
  const orderDate = formatChineseDate(allText)
  const buyerContact = textInBox(items, 450, 540, 678, 698).replace(/TEL[:：]?|Fax[:：]?/gi, '')
  return {
    supplier,
    orderNo,
    orderDate,
    buyerContact,
    fileItemNo: normalizeItemNo('', fileName),
  }
}

function tableHeaderY(items: PositionedText[]) {
  return items.find((item) => /^(貨號|货号)$/.test(cleanText(item.text)) && item.x < 70)?.y ?? 0
}

function rowBoundary(upperY: number, lowerY: number) {
  return lowerY + (upperY - lowerY) * 0.6
}

function valueInRowBand(
  items: PositionedText[],
  xMin: number,
  xMax: number,
  top: number,
  bottom: number,
) {
  return textInBox(items, xMin, xMax, bottom, top)
}

function nearestNumberInBand(
  items: PositionedText[],
  xMin: number,
  xMax: number,
  top: number,
  bottom: number,
  y: number,
) {
  const candidates = itemsInBox(items, xMin, xMax, bottom, top)
    .map((item) => ({ item, value: numberText(item.text) }))
    .filter((candidate) => candidate.value)
    .sort((a, b) => Math.abs(a.item.y - y) - Math.abs(b.item.y - y))
  return candidates[0]?.value ?? ''
}

export function purchaseOrderPdfItemsToAoa(items: PositionedText[], fileName?: string) {
  const hasPurchaseOrderLayout = items.some((item) =>
    /委托加工合同|採購單編號|采购单编号/.test(cleanText(item.text)))
  if (!hasPurchaseOrderLayout) return []

  const headerY = tableHeaderY(items)
  if (!headerY) return []

  const header = purchaseOrderHeader(items, fileName)
  const anchors = items
    .map((item) => ({ item, value: numberText(item.text) }))
    .filter(({ item, value }) => value && item.x >= 388 && item.x <= 421 && item.y < headerY - 5 && item.y > 80)
    .sort((a, b) => b.item.y - a.item.y)

  const rows: string[][] = []
  anchors.forEach((anchor, idx) => {
    const prev = anchors[idx - 1]?.item.y
    const next = anchors[idx + 1]?.item.y
    const top = prev == null ? headerY - 2 : rowBoundary(prev, anchor.item.y)
    const bottom = next == null ? Math.max(80, anchor.item.y - 85) : rowBoundary(anchor.item.y, next)
    const rawItemNo = valueInRowBand(items, 25, 72, top, bottom)
    const itemNo = normalizeItemNo(rawItemNo, fileName) || header.fileItemNo
    const product = valueInRowBand(items, 70, 143, top, bottom)
    const unitPrice = nearestNumberInBand(items, 445, 485, top, bottom, anchor.item.y)
    const notes = valueInRowBand(items, 524, 585, top, bottom)
    if (!product || !anchor.value || !unitPrice) return
    rows.push([
      header.supplier,
      header.buyerContact,
      itemNo,
      header.orderNo,
      product,
      anchor.value,
      header.orderDate,
      unitPrice,
      notes,
    ])
  })

  return rows.length ? [PURCHASE_ORDER_HEADERS, ...rows] : []
}

export function pdfTextRowsToAoa(items: PositionedText[]) {
  const rows = buildRows(items).map(mergeCloseItems)
  const out: string[][] = []
  let columns: PositionedText[] | null = null

  for (const row of rows) {
    const labels = row.map((item) => normalizeCell(item.text))
    const looksLikeHeader = REQUIRED_HEADERS.filter((header) => labels.includes(header)).length >= 2
    if (looksLikeHeader) {
      columns = row
      out.push(row.map((item) => normalizeCell(item.text)))
      continue
    }
    if (!columns) continue

    const cells = new Array(columns.length).fill('')
    for (const item of row) {
      const text = item.text.trim()
      if (!text) continue
      const col = nearestColumn(item.x, columns)
      cells[col] = cells[col] ? `${cells[col]} ${text}` : text
    }
    if (cells.some((cell) => cell.trim())) out.push(cells)
  }
  return out
}
