import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import type { Material } from '../api/client'
import { extractSheetImages } from './engineeringImport'
import { readToolPrice } from './toolPrice'

export interface ImportedMaterialGroup { code: string; materials: Material[] }
export interface IndonesiaMaterialImport { groups: ImportedMaterialGroup[]; warnings: string[] }
const text = (v: unknown) => String(v ?? '').trim()
const header = (v: unknown) => text(v).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const units: Record<string, string> = { 个: 'PCE', pcs: 'PCE', pce: 'PCE', 件: 'PCE', 千克: 'KGM', 公斤: 'KGM', kg: 'KGM', kgm: 'KGM', 套: 'SET', set: 'SET', 米: 'MTR', m: 'MTR', mtr: 'MTR', 吨: 'TNE', tne: 'TNE' }

export function parseIndonesiaMaterials(wb: XLSX.WorkBook, forTools = false) {
  const groups = new Map<string, Material[]>()
  const warnings: string[] = []
  const locations: { sheet: string; row: number; imageCol: number; material: Material }[] = []
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn]
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false,
      range: { s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(ws['!ref'] || 'A1').e } })
    const hi = grid.findIndex(row => row.some(v => header(v) === '货号') && row.some(v => header(v).startsWith('产品中文名称')))
    if (hi < 0) continue
    const names = grid[hi].map(header)
    const aliases: Record<string, string[]> = {
      '报关公司': ['报关公司', '报关主体'], '物料编码': ['物料编码', '物料编号', '料号'],
      '单个毛重': ['单个毛重', '单件毛重'], '单个净重': ['单个净重', '单件净重'],
      '每箱重量': ['每箱重量', '每箱毛重'], '长': ['箱长', '长'], '宽': ['箱宽', '宽'], '高': ['箱高', '高'],
    }
    const col = (label: string) => {
      const labels = (aliases[label] || [label]).map(header)
      const exact = names.findIndex(n => labels.includes(n))
      return exact >= 0 ? exact : names.findIndex(n => labels.some(l => n.startsWith(l)))
    }
    const get = (row: unknown[], label: string) => text(row[col(label)])
    for (let ri = hi + 1; ri < grid.length; ri++) {
      const row = grid[ri]
      const name = get(row, '产品中文名称')
      if (!name || /^(合计|总计|总合计|产品中文名称)/.test(name)) continue
      let code = get(row, '货号')
      // 仅继承真正的货号合并单元格，不盲目沿用上一行货号。
      if (!code) {
        const c = col('货号')
        const merge = ws['!merges']?.find(m => m.s.c === c && m.e.c === c && m.s.r <= ri && m.e.r >= ri)
        if (merge) code = text(grid[merge.s.r]?.[c])
      }
      if (!code && !forTools) { warnings.push(`${sn} 第 ${ri + 1} 行缺货号，已跳过：${name}`); continue }
      const number = (label: string, dimension = false) => {
        const cell = col(label) >= 0 ? ws[XLSX.utils.encode_cell({ r: ri, c: col(label) })] : undefined
        if (cell?.t === 'n' && Number.isFinite(cell.v) && cell.v >= 0) return Number(cell.v)
        const value = get(row, label)
        if (!value) return undefined
        const match = value.replace(/,/g, '').match(dimension ? /^(\d+(?:\.\d+)?)\s*(cm|mm|m|厘米|毫米|米)?$/i : /^(\d+(?:\.\d+)?)$/)
        if (!match) { warnings.push(`${sn} 第 ${ri + 1} 行“${label}”无法识别，保留原值`); return undefined }
        const unit = (match[2] || '').toLowerCase()
        return Number(match[1]) * (['mm', '毫米'].includes(unit) ? 0.1 : ['m', '米'].includes(unit) ? 100 : 1)
      }
      const rawUnit = get(row, '单位').toLowerCase()
      if (rawUnit && !units[rawUnit]) warnings.push(`${sn} 第 ${ri + 1} 行单位“${rawUnit}”未识别，保留原值`)
      const material: Material = {
        product_code: code, name_zh: name, name_en: get(row, '产品英文名称'), spec: get(row, '规格'),
        hs_cn: get(row, '中国HSCODE'), hs_id: get(row, '印尼HSCODE'), supplier: get(row, '供应商'),
        customs_company: get(row, '报关公司'), weight_per_carton: number('每箱重量'),
        unit_kg: units[rawUnit], gross_per_pc: number('单个毛重'), net_per_pc: number('单个净重'),
        qty_per_carton: number('每箱数量'), length: number('长', true), width: number('宽', true), height: number('高', true),
      }
      if (forTools) {
        const currency = get(row, '币种') || get(row, 'Currency')
        const priceCol = col('采购单价')
        const priceCell = priceCol >= 0 ? ws[XLSX.utils.encode_cell({ r: ri, c: priceCol })] : undefined
        const parsedPrice = readToolPrice(priceCell, currency)
        material.purchase_price = parsedPrice.price
        material.purchase_currency = parsedPrice.currency
        if (priceCell?.v != null && parsedPrice.price == null)
          warnings.push(`${sn} 第 ${ri + 1} 行：采购单价无法识别，保留原值`)
        if (parsedPrice.conflict)
          warnings.push(`${sn} 第 ${ri + 1} 行：单价格式和币种标记不一致，请确认币种`)
        if (material.purchase_price != null && !material.purchase_currency)
          warnings.push(`${sn} 第 ${ri + 1} 行：采购单价已读取，币种${currency ? '无法识别' : '未填写'}，请确认`)
        material.related_product_code = code
        delete material.product_code
        material.material_code = get(row, '物料编码')
        const kind = get(row, '类别') || get(row, '产品用途')
        if (['工具', '模具', '耗材'].includes(kind)) material.tool_kind = '工具'
        else if (['设备', '机器', '机器设备'].includes(kind)) material.tool_kind = '机器设备'
        else warnings.push(`${sn} 第 ${ri + 1} 行：请确认物料类别（用途：${kind || '未填'}）`)
        if (material.net_per_pc != null && material.gross_per_pc != null && material.net_per_pc > material.gross_per_pc) {
          warnings.push(`${sn} 第 ${ri + 1} 行：单件净重大于毛重，已保留文件原值，请核对`)
        }
      }
      const list = groups.get(code) || []
      const duplicate = list.find(m => JSON.stringify(m) === JSON.stringify(material))
      if (!duplicate) list.push(material)
      groups.set(code, list)
      locations.push({ sheet: sn, row: ri, imageCol: col('图片'), material: duplicate || material })
    }
  }
  return { groups: [...groups].map(([code, materials]) => ({ code, materials })), warnings, locations }
}

export async function importIndonesiaMaterialFile(file: File, forTools = false): Promise<IndonesiaMaterialImport> {
  const buffer = await file.arrayBuffer()
  const parsed = parseIndonesiaMaterials(XLSX.read(buffer, { type: 'array', cellNF: true }), forTools)
  if (!parsed.groups.length) throw new Error('未识别到物料：需包含“货号”和“产品中文名称”表头')
  const zip = await JSZip.loadAsync(buffer)
  for (const sn of new Set(parsed.locations.map(l => l.sheet))) {
    const images = await extractSheetImages(zip, sn, forTools)
    for (const location of parsed.locations.filter(l => l.sheet === sn)) {
      const matches = images.filter(image => image.row === location.row && image.col === location.imageCol)
      if (matches.length === 1) location.material.image = matches[0].dataUrl
      else if (matches.length > 1) parsed.warnings.push(`${sn} 第 ${location.row + 1} 行有多张图片，请手动选择图片`)
    }
  }
  return { groups: parsed.groups, warnings: parsed.warnings }
}
