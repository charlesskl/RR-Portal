// Parse 工程放产资料 Excel — extract moldings + materials for a given product.
// Ported from legacy 印尼走货明细生成系统.html importEngineeringFile() + extractSheetImages().

import JSZip from 'jszip'
import type { Material, Molding, MoldingPart } from '../api/client'
import { translatePartName } from './partTranslate'

// HS 编码字典：按名称关键字匹配（顺序=先具体后通用）。移植自旧版 HS_DICT + inferHsCode。
const HS_DICT: { test: RegExp; hsCN: string; hsID: string }[] = [
  { test: /螺丝|螺母|铆钉|垫圈|弹簧/, hsCN: '7318159001', hsID: '731815' },
  { test: /铁线|钢丝/, hsCN: '7223000000', hsID: '722300' },
  { test: /轮轴|轮架|轴承/, hsCN: '8482109000', hsID: '848210' },  // 仅真正的轮轴/轴承，避免「前轮挡泥板」误判
  { test: /搪胶|公仔|玩具|figure|toy/i, hsCN: '9503009000', hsID: '950300' },
  { test: /喷油|印刷件/, hsCN: '3923900000', hsID: '392390' },
  { test: /塑胶|塑料|车身|车窗|车底|底架|车架|外壳|配件|按钮|手柄|罩|底盖|盖|片|杆|柱|架/, hsCN: '3923900000', hsID: '392390' },
  { test: /吸塑|blister/i, hsCN: '3923300090', hsID: '392330' },
  { test: /彩盒|彩咭|内咭|绑咭|咭|gift\s*box|color\s*box|carton/i, hsCN: '4819200000', hsID: '481920' },
  { test: /纸箱|外箱/, hsCN: '4819100000', hsID: '481910' },
  { test: /雪梨纸|tissue/i, hsCN: '4823909000', hsID: '480640' },
  { test: /说明书|利宝|booklet|manual|instruction/i, hsCN: '4911101000', hsID: '491110' },
  { test: /贴纸|标贴|sticker|label/i, hsCN: '4911999090', hsID: '491199' },
  { test: /胶袋|OPP|PE\s*袋|气泡袋|polybag/i, hsCN: '3923210000', hsID: '392321' },
  { test: /胶带|tape/i, hsCN: '3919900000', hsID: '391990' },
  { test: /胶水|glue|adhesive/i, hsCN: '3506990000', hsID: '350699' },
  { test: /电池|battery/i, hsCN: '8506101100', hsID: '850610' },
  { test: /电线|电缆|wire|cable/i, hsCN: '8544422100', hsID: '854442' },
  { test: /喇叭|speaker|horn/i, hsCN: '8518290000', hsID: '851829' },
  { test: /电板|PCB|电子件/i, hsCN: '8534001000', hsID: '853400' },
  { test: /马达|motor/i, hsCN: '8501101900', hsID: '850110' },
  { test: /橡皮筋|橡胶|rubber\s*band/i, hsCN: '4007000000', hsID: '400700' },
  { test: /发泡|EVA|foam/i, hsCN: '3921110000', hsID: '392111' },
  { test: /pvc|PVC/, hsCN: '3920430090', hsID: '392043' },
]
export interface HsDictEntry { keyword?: string; hsCN?: string; hsID?: string }
// 用户字典优先（含关键字即命中），再退回内置规则。与旧版 inferHsCode 一致。
export function inferHsCode(name?: string, userDict?: HsDictEntry[]): { hsCN: string; hsID: string } {
  const t = String(name || '')
  for (const r of (userDict || [])) {
    if (!r.keyword) continue
    if (t.includes(r.keyword)) return { hsCN: r.hsCN || '', hsID: r.hsID || '' }
  }
  for (const r of HS_DICT) if (r.test.test(t)) return { hsCN: r.hsCN, hsID: r.hsID }
  return { hsCN: '', hsID: '' }
}

// 从 xlsx 某个 sheet 提取内嵌图片 → [{row,col,dataUrl}]（row/col 0-indexed）
// 兼容：① 标准 xdr 锚定图片 ② WPS DISPIMG 单元格图(cellimages.xml)。移植自旧版 extractSheetImages。
async function extractSheetImages(zip: JSZip, targetSheetName: string): Promise<{ row: number; col: number; dataUrl: string }[]> {
  try {
    const wbFile = zip.file('xl/workbook.xml'); if (!wbFile) return []
    const wbXml = await wbFile.async('string')
    const wbDoc = new DOMParser().parseFromString(wbXml, 'application/xml')
    const sheetNodes = wbDoc.getElementsByTagName('sheet')
    let sheetIdx: number | null = null
    for (let i = 0; i < sheetNodes.length; i++) {
      if (sheetNodes[i].getAttribute('name') === targetSheetName) { sheetIdx = i + 1; break }
    }
    if (!sheetIdx) return []
    const imgList: { row: number; col: number; dataUrl: string }[] = []
    const toDataUrl = async (mediaPath: string): Promise<string | null> => {
      const f = zip.file(mediaPath); if (!f) return null
      const u8 = await f.async('uint8array')
      const ext = (mediaPath.split('.').pop() || '').toLowerCase()
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/' + ext
      let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
      return 'data:' + mime + ';base64,' + btoa(bin)
    }
    // ① 标准 xdr 锚定
    const relsFile = zip.file(`xl/worksheets/_rels/sheet${sheetIdx}.xml.rels`)
    let anchors: Element[] = []
    const embedToTarget: Record<string, string> = {}
    if (relsFile) {
      const relsDoc = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml')
      let drawingTarget: string | null = null
      for (const rel of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
        if ((rel.getAttribute('Type') || '').endsWith('/drawing')) { drawingTarget = rel.getAttribute('Target'); break }
      }
      if (drawingTarget) {
        const drawingPath = ('xl/worksheets/' + drawingTarget).replace(/[^/]+\/\.\.\//g, '')
        const drawingFile = zip.file(drawingPath)
        if (drawingFile) {
          const drawingDoc = new DOMParser().parseFromString(await drawingFile.async('string'), 'application/xml')
          anchors = [
            ...Array.from(drawingDoc.getElementsByTagName('xdr:twoCellAnchor')),
            ...Array.from(drawingDoc.getElementsByTagName('xdr:oneCellAnchor')),
          ]
          const dRelsFile = zip.file(drawingPath.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels'))
          if (dRelsFile) {
            const dRelsDoc = new DOMParser().parseFromString(await dRelsFile.async('string'), 'application/xml')
            for (const rel of Array.from(dRelsDoc.getElementsByTagName('Relationship'))) {
              embedToTarget[rel.getAttribute('Id') || ''] = rel.getAttribute('Target') || ''
            }
          }
        }
      }
    }
    for (const anchor of anchors) {
      const fromNode = anchor.getElementsByTagName('xdr:from')[0]; if (!fromNode) continue
      const rowEl = fromNode.getElementsByTagName('xdr:row')[0]; if (!rowEl) continue
      const row = parseInt(rowEl.textContent || '0', 10)
      const colEl = fromNode.getElementsByTagName('xdr:col')[0]
      const col = colEl ? parseInt(colEl.textContent || '0', 10) : 0
      const blip = anchor.getElementsByTagName('a:blip')[0]; if (!blip) continue
      const target = embedToTarget[blip.getAttribute('r:embed') || '']
      if (!target) continue
      const dataUrl = await toDataUrl(('xl/' + target.replace(/^\.\.\//, '')).replace(/[^/]+\/\.\.\//g, ''))
      if (dataUrl) imgList.push({ row, col, dataUrl })
    }
    // ② WPS DISPIMG 单元格图
    try {
      const ciFile = zip.file('xl/cellimages.xml')
      const ciRelsFile = zip.file('xl/_rels/cellimages.xml.rels')
      if (ciFile && ciRelsFile) {
        const ciDoc = new DOMParser().parseFromString(await ciFile.async('string'), 'application/xml')
        const ciRelsDoc = new DOMParser().parseFromString(await ciRelsFile.async('string'), 'application/xml')
        const embed2target: Record<string, string> = {}
        for (const rel of Array.from(ciRelsDoc.getElementsByTagName('Relationship'))) {
          embed2target[rel.getAttribute('Id') || ''] = rel.getAttribute('Target') || ''
        }
        const idToData: Record<string, string> = {}
        const picNodes = ciDoc.getElementsByTagName('etc:cellImage')
        for (let i = 0; i < picNodes.length; i++) {
          const pic = picNodes[i]
          const id = pic.getElementsByTagName('xdr:cNvPr')[0]?.getAttribute('name') || pic.getAttribute('name') || ''
          const blip = pic.getElementsByTagName('a:blip')[0]
          if (!blip || !id) continue
          const target = embed2target[blip.getAttribute('r:embed') || '']
          if (!target) continue
          const dataUrl = await toDataUrl(('xl/' + target.replace(/^\.\.\//, '')).replace(/[^/]+\/\.\.\//g, ''))
          if (dataUrl) idToData[id] = dataUrl
        }
        const sheetFile = zip.file('xl/worksheets/sheet' + sheetIdx + '.xml')
        if (sheetFile) {
          const sheetXml = await sheetFile.async('string')
          const colLetterToNum = (s: string) => { let n = 0; for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1 }
          for (const re of [/<c\s+r="([A-Z]+)(\d+)"[^>]*>[\s\S]*?DISPIMG\(&quot;([^&]+)&quot;[\s\S]*?<\/c>/g,
                            /<c\s+r="([A-Z]+)(\d+)"[^>]*>[\s\S]*?DISPIMG\("([^"]+)"[\s\S]*?<\/c>/g]) {
            let m: RegExpExecArray | null
            while ((m = re.exec(sheetXml)) !== null) {
              const col = colLetterToNum(m[1]); const row = parseInt(m[2], 10) - 1
              if (idToData[m[3]]) imgList.push({ row, col, dataUrl: idToData[m[3]] })
            }
          }
        }
      }
    } catch { /* ignore DISPIMG parse errors */ }
    // 仅过滤明显的装饰图（同一张图出现 >=5 次，如页眉 logo/边框）。
    // 共用产品照（如加强性胶钉 60/80/90 用同一张、吸塑 A/B/C 共用）出现 2~3 次，需保留。
    const cnt: Record<string, number> = {}
    for (const it of imgList) cnt[it.dataUrl] = (cnt[it.dataUrl] || 0) + 1
    return imgList.filter(it => cnt[it.dataUrl] < 5)
  } catch { return [] }
}

export interface EngineeringImportResult {
  code: string
  name: string
  customer?: string
  moldings: Molding[]
  materials: Material[]
}

const isValidName = (s: string) => !!s && s.length >= 1 && !/^[\d.\-_+]+$/.test(s) && /[一-鿿A-Za-z]/.test(s)

function stripCodePrefix(s: string, code: string): string {
  if (!s) return ''
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(s).replace(new RegExp('^' + esc + '[-\\s]?'), '').trim()
}
function stripAnyCode(s: string, code: string): string {
  if (!s) return ''
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(s)
    .replace(new RegExp('^' + esc + '[-\\s]?', 'i'), '')
    .replace(/^\d{4,6}[A-Z]?[-\s]+/i, '')
    .replace(/\s*-\s*\d{4,6}[A-Z]?\s*-\s*/g, '-')
    .trim()
}

// 标准物料类别（与"类别 / 金额 / 备注"对照表一致）
export const MATERIAL_CATEGORIES = [
  '原料', '色粉', '化学品-油漆', '化学品-其它', '电子类', '机器设备', '工具',
  '五金', '吸塑', '利宝说明书', '彩盒/彩咭', '纸箱类', '车缝类', '其它类', '大陆送半成品',
]

// 按关键字把任意文本(类别原值 / 物料名 / 规格)归类到标准类别
export function inferMaterialCategory(s: string): string {
  const t = String(s || '')
  if (!t.trim()) return ''
  if (MATERIAL_CATEGORIES.includes(t.trim())) return t.trim()
  if (/油漆|paint/i.test(t)) return '化学品-油漆'
  if (/油墨|化学|溶剂|稀释|ink|glue|胶水/i.test(t)) return '化学品-其它'
  if (/吸塑|blister/i.test(t)) return '吸塑'
  if (/彩盒|彩咭|彩卡|彩咕|color\s*box|gift\s*box|底托|底卡|加固咭|insert\s*card/i.test(t)) return '彩盒/彩咭'
  if (/纸箱|外箱|carton|卡板|栈板|pallet/i.test(t)) return '纸箱类'
  if (/利宝|说明书|insert|贴纸|sticker|标贴|条码|barcode|吊牌|卡头/i.test(t)) return '利宝说明书'
  if (/电池|pcba|电子|喇叭|pcb|\bic\b|线材|端子|马达|灯|喇叭/i.test(t)) return '电子类'
  if (/螺丝|螺母|铆钉|弹簧|车轮轴|轴承|介子|垫片|\b钉\b|五金|hardware/i.test(t)) return '五金'
  if (/夹具|治具|模具|tooling|mould|mold/i.test(t)) return '工具'
  if (/裁片|车缝|布料|绒|sewing|fabric/i.test(t)) return '车缝类'
  if (/胶件|吹气|搪胶|半成品|大陆送/i.test(t)) return '大陆送半成品'
  if (/色粉|pigment|colorant/i.test(t)) return '色粉'
  if (/原料|塑料粒|abs|\bpp\b|\bpvc\b|\bpe\b|resin/i.test(t)) return '原料'
  if (/机器|设备|machine|equipment/i.test(t)) return '机器设备'
  return '其它类'
}

export async function importEngineeringFile(file: File, opts?: { hsDict?: HsDictEntry[] }): Promise<EngineeringImportResult> {
  const hsDict = opts?.hsDict
  const XLSX = await import('xlsx')
  const ab = await file.arrayBuffer()
  const wb = XLSX.read(ab, { type: 'array' })
  const zip = await JSZip.loadAsync(ab).catch(() => null)  // 用于提取内嵌图片

  const findSheet = (kws: string[]) => wb.SheetNames.find(n => kws.some(k => n.includes(k)))
  const snMold = findSheet(['排模'])
  const snExt  = findSheet(['外购'])

  if (!snMold && !snExt) throw new Error('未找到 "排模表" 或 "外购清单" sheet')

  // -------- 1. read code/name from 排模 sheet header --------
  let code = '', name = '', customer = ''
  if (snMold) {
    const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[snMold], { header: 1, defval: null })
    // 关键字按优先级排（产品编号/产品名称 优先；编号/名称 兜底）。
    // 注意：整张抬头常被合并成「单个大字符串」(如 "...文件 编号: HSQR0008 ... 产品编号:46720J ...")，
    // 所以必须「按关键字优先级跨所有行扫描」，否则前面行的 文件编号 会先命中 编号。
    const codeKeys = ['产品编号', '产品编码', '产品code', '货号', 'Product Number', 'Product No', 'ItemNo', 'Item No', '编号']
    const nameKeys = ['产品名称', '品名', '产品名', 'Product Name', 'ProductName', '名称']
    const scanRows = Math.min(10, grid.length)
    const boundary = '(?<![\\u4e00-\\u9fa5])'  // 前一字符非中文：允许英文双语前缀，仍挡住 客户名称→名称/工模编号→编号
    // 按关键字优先级查值：valRe 取值正则（同格）；否则邻格取值。整列扫描后返回首个命中。
    // reject：跳过某些值（如客户的英文占位 TomyCustomer），继续找下一个
    const findVal = (keys: string[], valRe: (k: string) => RegExp, reject?: (v: string) => boolean): string => {
      for (const k of keys) {
        for (let r = 0; r < scanRows; r++) {
          const row = grid[r] || []
          for (let c = 0; c < row.length; c++) {
            const s = String(row[c] ?? '').trim()
            if (!s) continue
            // 同格：遍历所有匹配（一格内可能有多个同名标签，如 客户名称:TomyCustomer 客户名称：TOMY）
            let hadMatch = false
            for (const m of s.matchAll(valRe(k))) {
              hadMatch = true
              const v = (m[1] || '').trim()
              if (v && !(reject && reject(v))) return v
            }
            // 邻格：本格含关键字（作标签，整格无内联值），值在右邻 1~3 格（去前导冒号/空格）
            // 例 "产品编号 Produk Nomer" | ": 47712A"
            if (!hadMatch && new RegExp(`${boundary}${k}`, 'i').test(s)) {
              for (let off = 1; off <= 3 && c + off < row.length; off++) {
                const v = String(row[c + off] ?? '').replace(/^[：:\s]+/, '').trim()
                if (v && !(reject && reject(v))) return v
              }
            }
          }
        }
      }
      return ''
    }
    // 取值截断：遇「2+空格(列分隔)」或「下一个标签词」或行尾即止（应对同格多字段且仅单空格分隔）
    const STOP = '(?=\\s{2,}|\\s+(?:客户|产品|编制|审核|批准|日期|版本|文件|页码|PAGE|Product|Customer|No\\.|Revisi|Tgl|Halaman|Nama|Nomer|Disiapkan|Diperiksa|Disetujui|Tanggal)|$)'
    // 货号值：取冒号后连续非空白；名称/客户值：到截断处之前
    code = findVal(codeKeys, k => new RegExp(`${boundary}${k}\\s*[：:]\\s*(\\S+)`, 'gi'))
    // 客户：跳过英文占位（含 Customer/Name/名称）；取首个真实值（如 TOMY）
    const customerKeys = ['客户名称', '客户', 'Customer', '客户名']
    customer = findVal(customerKeys,
      k => new RegExp(`${boundary}${k}\\s*[：:]\\s*([^\\s].*?)${STOP}`, 'gi'),
      v => /customer|name|名称/i.test(v))
    name = findVal(nameKeys, k => new RegExp(`${boundary}${k}\\s*[：:]\\s*([^\\s].*?)${STOP}`, 'gi'))
  }
  if (!code) {
    // Dump first few rows for debugging
    const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[snMold!], { header: 1, defval: null })
    const preview = grid.slice(0, 5).map((r, i) => `行${i + 1}: ${(r || []).map(c => String(c ?? '').slice(0, 30)).join(' | ')}`).join('\n')
    throw new Error(`未在排模表前 10 行找到"产品编号"。试过关键字：${['产品编号', '货号', '产品编码', '编号', 'ItemNo'].join(', ')}\n\n前 5 行预览：\n${preview}`)
  }

  const moldings: Molding[] = []
  const materials: Material[] = []

  // -------- 2. 排模表: 工模 → 子零件 --------
  if (snMold) {
    const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[snMold], { header: 1, defval: null })
    let hdrIdx = 3
    for (let r = 0; r < Math.min(10, grid.length); r++) {
      const joined = (grid[r] || []).map(c => String(c ?? '').replace(/\s+/g, '')).join('|')
      if (joined.includes('工模编号') && joined.includes('物料名称')) { hdrIdx = r; break }
    }
    const headers = (grid[hdrIdx] || []).map((c: any) => String(c ?? '').replace(/\s+/g, ''))
    const colOf = (...kws: string[]) => {
      for (const k of kws) { const i = headers.findIndex(h => h.includes(k)); if (i >= 0) return i }
      return -1
    }
    const cMoldId   = colOf('工模编号', 'MoldNumber')
    const cMoldName = colOf('工模名称', 'MoldName')
    const cPartNo   = colOf('零件编号', 'PartNumber', 'NoPart')
    const cPartName = colOf('物料名称', 'MaterialName')
    const cPartEn   = colOf('英文物料', 'Englishmaterial')
    const cMaterial = colOf('用料名称', 'Materialused')
    const cColor    = colOf('顔色', '颜色', 'Color')
    const cPigment  = colOf('色粉号', 'PigmentNumber', 'Pigment')
    const cNet      = colOf('整啤净重', 'Netweight')
    const cNetPer   = colOf('单净重', '单个净重', 'NetWeight(perunit)', 'NetWeightperunit', 'Netweightperunit')
    const cGrossPer = colOf('单毛重', '单个毛重', 'GrossWeight(perunit)', 'Grossweightperunit')
    const cUsage    = colOf('用量', '数量', 'Qty', 'Quantity')
    const cSets     = colOf('套数', 'Sets')
    const cEjections= colOf('出模数', 'Ejections', 'NumberofEjections')
    const cPlace    = colOf('生产地', 'PlaceofManufacture', 'Manufacture', '产地')

    let curMold: { prefix: string; cat: string; place: string; entry: Molding } | null = null
    for (let r = hdrIdx + 1; r < grid.length; r++) {
      const row = grid[r] || []
      const moldName = cMoldName >= 0 ? String(row[cMoldName] ?? '').trim() : ''
      const partName = cPartName >= 0 ? String(row[cPartName] ?? '').trim() : ''
      const partEn   = cPartEn   >= 0 ? String(row[cPartEn]   ?? '').trim() : ''
      const partNo   = cPartNo   >= 0 ? String(row[cPartNo]   ?? '').trim() : ''
      const mat      = cMaterial >= 0 ? String(row[cMaterial] ?? '').trim() : ''
      if (isValidName(moldName)) {
        // start new 工模
        const prefix = /搪胶/.test(mat) ? '搪胶件' : '塑胶件'
        const cat = prefix === '搪胶件' ? '搪胶' : '塑胶'
        const place = cPlace >= 0 ? String(row[cPlace] ?? '').trim() : ''
        const rawColor = cColor >= 0 ? String(row[cColor] ?? '').trim() : ''
        let colorName = rawColor, colorCode = ''
        const splitIdx = rawColor.search(/[/／|]/)
        if (splitIdx >= 0) {
          colorName = rawColor.slice(0, splitIdx).trim()
          colorCode = rawColor.slice(splitIdx + 1).trim()
        }
        const pigmentCode = cPigment >= 0 ? String(row[cPigment] ?? '').trim() : ''
        const netG = Number(row[cNet]) || 0
        const entry: Molding = {
          moldId: cMoldId >= 0 ? String(row[cMoldId] ?? '').trim() : '',
          moldName, materialName: mat,
          colorCode, colorName, pigmentCode,
          netGramsPerShot: netG,
          setsPerShot: 1,
          workshop: prefix === '搪胶件' ? '华登' : '兴信A车间',
          parts: [], notes: '',
        }
        if (!place || /中国|China|CN/i.test(place)) moldings.push(entry)
        curMold = { prefix, cat, place, entry }
        continue
      }
      // sub part row
      if (!curMold || !isValidName(partName)) continue
      if (curMold.place && !/中国|China|CN/i.test(curMold.place)) continue
      const cleanName = stripCodePrefix(partName, code)
      const cleanEn   = stripCodePrefix(partEn, code)
      const enPrefix = curMold.prefix === '搪胶件' ? 'Vinyl parts' : 'Plastic parts'
      // Excel 无英文 → 用本地词典翻译中文部件名
      const enBody = cleanEn || translatePartName(cleanName)
      const partFullName = curMold.prefix + '-' + cleanName
      const partHs = inferHsCode(partFullName, hsDict)
      const part: MoldingPart = {
        partCode: partNo || '',
        partName: partFullName,
        partNameEn: enBody ? `${enPrefix} - ${enBody}` : '',
        hsCN: partHs.hsCN,
        hsID: partHs.hsID,
        category: curMold.cat,
        ejections: cEjections >= 0 ? (Number(row[cEjections]) || 0) : 0,
        usage:     cUsage    >= 0 ? (Number(row[cUsage])    || 0) : 0,
        grossPerPc: cGrossPer >= 0 ? ((Number(row[cGrossPer]) || 0) / 1000) : 0,
        netPerPc:   cNetPer   >= 0 ? ((Number(row[cNetPer])   || 0) / 1000) : 0,
      }
      curMold.entry.parts!.push(part)
      // first 套数 → setsPerShot
      if (cSets >= 0 && (curMold.entry.setsPerShot ?? 1) <= 1) {
        const s = Number(row[cSets]) || 0
        if (s > 0) curMold.entry.setsPerShot = s
      }
      // 注意：排模表的塑胶/搪胶件只保留在 moldings（排模表），不写入物料子表，
      // 避免与「外购清单」重复（与旧版 importEngineeringFile 行为一致）。
    }
  }

  // -------- 3. 外购清单 --------
  if (snExt) {
    const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[snExt], { header: 1, defval: null })
    let hdrIdx = 3
    for (let r = 0; r < Math.min(10, grid.length); r++) {
      const joined = (grid[r] || []).map(c => String(c ?? '').replace(/\s+/g, '')).join('|')
      if (joined.includes('物料名称') && joined.includes('类别')) { hdrIdx = r; break }
    }
    const headers = (grid[hdrIdx] || []).map((c: any) => String(c ?? '').replace(/\s+/g, ''))
    const colOf = (...kws: string[]) => {
      for (const k of kws) { const i = headers.findIndex(h => h.includes(k)); if (i >= 0) return i }
      return -1
    }
    const cCat      = colOf('类别', 'Jenis')
    const cName     = colOf('物料名称', 'MaterialName')
    const cEn       = colOf('英文名', 'Englishname')
    const cSpec     = colOf('规格', 'Spesifikasi')
    const cSupplier = colOf('供应商', 'Supplier')
    const cWt       = colOf('单重', 'Berat')
    const cPlace    = colOf('生产地', 'PlaceofManufacture', 'Manufacture', '产地')

    for (let r = hdrIdx + 1; r < grid.length; r++) {
      const row = grid[r] || []
      const rawName = cName >= 0 ? String(row[cName] ?? '').trim() : ''
      if (!rawName) continue
      if (cPlace >= 0) {
        const place = String(row[cPlace] ?? '').trim()
        if (place && !/中国|China|CN/i.test(place)) continue
      }
      const catRaw = cCat >= 0 ? String(row[cCat] ?? '').trim() : ''
      if (/\bIC\b/i.test(catRaw + ' ' + rawName)) continue
      const cleanName = stripAnyCode(stripCodePrefix(rawName, code), code)
      const rawEn = cEn >= 0 ? String(row[cEn] ?? '').trim() : ''
      const cleanEn = stripAnyCode(rawEn, code)
      let fullName: string, fullEn: string, cat: string
      if (/五金|Hardware/i.test(catRaw)) {
        cat = '五金'
        if (/螺丝|螺母/.test(cleanName)) {
          fullName = cleanName; fullEn = cleanEn
        } else {
          fullName = '五金配件-' + cleanName
          fullEn = cleanEn ? ('Hardware Accessories - ' + cleanEn) : ''
        }
      } else {
        cat = inferMaterialCategory(catRaw + ' ' + rawName + ' ' + (cSpec >= 0 ? String(row[cSpec] ?? '') : ''))
        fullName = cleanName; fullEn = cleanEn
      }
      materials.push({
        id: 0,
        product_code: code,
        item_no: code,
        name_zh: fullName,
        name_en: fullEn,
        spec: cSpec >= 0 ? String(row[cSpec] ?? '').trim() : '',
        category: cat,
        supplier: cSupplier >= 0 ? String(row[cSupplier] ?? '').trim() : '',
        customs_company: '',
        ...((h) => ({ hs_cn: h.hsCN, hs_id: h.hsID }))(inferHsCode(fullName + ' ' + cat, hsDict)),
        unit_kg: 'KGM',
        gross_per_pc: 0,
        net_per_pc: cWt >= 0 ? ((Number(row[cWt]) || 0) / 1000) : 0,
        length: 0, width: 0, height: 0,
        qty_per_carton: 0, weight_per_carton: 0,
        active: true,
        usage_qty: 1,
      })
    }
  }

  // -------- 4. BOM图 / 外购图：格子排版图片 + 附近文字标签 → 匹配到物料/排模件 --------
  // 移植自旧版：图片在 row N，名称多在 row N+1~N+2 同列；按"去公共词"后的核心名匹配。
  if (zip) {
    const imageSheets: string[] = []
    const snBom = findSheet(['BOM', 'bom'])
    if (snBom) imageSheets.push(snBom)
    for (const sn of wb.SheetNames) {
      if (sn === snBom) continue
      if (/外购/.test(sn) && (/图/.test(sn) || /规格/.test(sn))) imageSheets.push(sn)
    }
    if (imageSheets.length) {
      const productStripStr = String(name || '').replace(/[^一-龥A-Za-z]/g, '')
      const stripCommon = (s: any): string => {
        let r = String(s ?? '')
          .replace(/^(塑胶件|塑料件|搪胶件|吸塑件|五金件|五金配件)[-：:\s]?/, '')
          .replace(/^\d{4,6}[A-Z]?[-\s]+/i, '')
        if (productStripStr && productStripStr.length >= 3) r = r.split(productStripStr).join('')
        return r.replace(/\s+|[-_·.,()（）【】《》""''「」/]/g, '').toLowerCase()
      }
      const nameMap: Record<string, { image?: string }> = {}
      for (const m of materials) { if (!m.name_zh) continue; const k = stripCommon(m.name_zh); if (k && !nameMap[k]) nameMap[k] = m }
      for (const md of moldings) for (const pt of (md.parts || [])) { if (!pt.partName) continue; const k = stripCommon(pt.partName); if (k && !nameMap[k]) nameMap[k] = pt }
      const looseMatch = (cellText: any): { image?: string } | null => {
        const k = stripCommon(cellText)
        if (!k || k.length < 2) return null
        if (nameMap[k]) return nameMap[k]
        // ① 标签核心词 完整包含 物料核心词（取最长，防短词覆盖长词）
        const cands = Object.entries(nameMap).filter(([nk]) => nk.length >= 2 && k.includes(nk)).sort((a, b) => b[0].length - a[0].length)
        if (cands.length) return cands[0][1]
        // ② 反向后缀：物料核心 以 标签核心 结尾（如 标签"左门" ⊂ 料"车左门"、"按件" ⊂ "车顶按件"）。
        //    只认"结尾"可挡住误挂——标签"后车轮"不是料"前后车轮轴"(以轴结尾)的后缀。取多余前缀最短者。
        const rev = Object.entries(nameMap).filter(([nk]) => nk.length > k.length && nk.endsWith(k)).sort((a, b) => a[0].length - b[0].length)
        return rev.length ? rev[0][1] : null
      }
      for (const sn of imageSheets) {
        const imgs = await extractSheetImages(zip, sn)
        const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sn], { header: 1, defval: null })
        const used = new Set<string>()
        for (const { row: r, col: c, dataUrl } of imgs) {
          if (!dataUrl) continue
          const key = r + '_' + c; if (used.has(key)) continue; used.add(key)
          // 只看图片正下方 1~2 行同列（BOM 布局：图在上、标签紧贴下一行）。
          // 不再向下越界扫描，避免本图标签匹配不到时串到下一组的标签上（如 B吸塑→胶水）。
          let hit: { image?: string } | null = null
          for (const dr of [1, 2]) {
            if (hit) break
            const probe = grid[r + dr]; if (!probe) continue
            for (const dc of [0, 1, -1]) {
              const cell = probe[c + dc]; if (cell == null || cell === '') continue
              const cand = looseMatch(cell)
              if (cand) { hit = cand; break }
            }
          }
          if (hit && !hit.image) hit.image = dataUrl
        }
      }
    }
  }

  return { code, name, customer, moldings, materials }
}
