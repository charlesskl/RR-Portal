import { translatePartName } from './partTranslate'

// 常用物料中文名 → 报关资料英文名。只在整行可完整翻译时返回结果，
// 避免把半中半英的内容误写入英文名字段。
const MATERIAL_TERMS: Array<[string, string]> = [
  ['五金配件', 'Hardware accessories'],
  ['前/后轮双波花轴', 'Front/Rear Wheel Double Knurled Axle'],
  ['前后轮双波花轴', 'Front/Rear Wheel Double Knurled Axle'],
  ['双波花轴', 'Double Knurled Axle'],
  ['波花轴', 'Knurled Axle'],
  ['前后车轮轴', 'Front/Rear Wheel Axle'],
  ['前车轮轴', 'Front Wheel Axle'],
  ['后车轮轴', 'Rear Wheel Axle'],
  ['车轮轴', 'Wheel Axle'],
  ['挖掘机贴纸', 'Excavator Sticker'],
  ['毛绒裁片', 'Plush Fabric Cut Piece'],
  ['塑胶件', 'Plastic Part'],
  ['搪胶件', 'Vinyl Part'],
  ['强力线', 'High-strength Thread'],
  ['产品贴纸', 'Product Sticker'],
  ['膜内贴纸', 'In-mold Sticker'],
  ['热熔胶', 'Hot-melt Adhesive'],
  ['橡皮筋', 'Rubber Band'],
  ['说明书', 'Instruction Manual'],
  ['彩盒', 'Color Box'],
  ['纸箱', 'Carton'],
  ['吊牌', 'Hang Tag'],
  ['标签', 'Label'],
  ['贴纸', 'Sticker'],
  ['螺丝', 'Screw'],
  ['螺母', 'Nut'],
  ['铆钉', 'Rivet'],
  ['平头钉', 'Flat-head Pin'],
  ['花钉', 'Knurled Pin'],
  ['轮轴', 'Wheel Axle'],
  ['拉簧', 'Extension Spring'],
  ['压簧', 'Compression Spring'],
  ['扭簧', 'Torsion Spring'],
  ['弹簧', 'Spring'],
  ['胶水', 'Adhesive'],
  ['胶针', 'Plastic Tag Pin'],
  ['内卡', 'Inner Card'],
  ['内咭', 'Inner Card'],
  ['吸塑', 'Blister'],
  ['网袋', 'Mesh Bag'],
  ['电池', 'Battery'],
  ['织带', 'Webbing'],
  ['棉带', 'Cotton Tape'],
]

function cleanEnglish(value: string): string {
  return value
    .replace(/[：:]/g, ': ')
    .replace(/\s+[-－—]\s*/g, ' - ')
    .replace(/\s*[-－—]\s+/g, ' - ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .trim()
}

export function translateMaterialName(zh?: string): string {
  const source = String(zh || '').trim()
  if (!source) return ''
  if (!/[\u3400-\u9fff]/.test(source)) return source

  const part = translatePartName(source)
  if (part) return part

  let translated = source
  for (const [cn, en] of MATERIAL_TERMS) {
    translated = translated.split(cn).join(` ${en} `)
  }

  // 有未识别中文时保持空白，交给使用者人工确认，避免生成错误的半翻译名称。
  if (/[\u3400-\u9fff]/.test(translated)) return ''
  return cleanEnglish(translated)
}
