import type { Material } from '../api/client'

export function shipmentImages(material?: Material | null): string[] {
  const values = Array.isArray(material?.shipment_images) ? material.shipment_images : [material?.image]
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

export function withShipmentImages(material: Material, images: readonly string[]): Material {
  const values = [...new Set(images)]
  return { ...material, image: values[0] || '', shipment_images: values }
}

/** Browser compression shared by Excel photos and manually added photos. */
export async function compressShipmentImage(blob: Blob): Promise<string> {
  if (blob.size > 32 * 1024 * 1024) throw new Error('单张图片不能超过 32 MB')
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片预览')
    for (const size of [768, 512, 320, 192, 128]) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const image = canvas.toDataURL('image/jpeg', 0.75)
      if (image.length <= 24 * 1024 && image.startsWith('data:image/jpeg;base64,')) return image
    }
    throw new Error('图片压缩后仍过大')
  } finally { bitmap.close() }
}

/** Only snapshot photos change; stock, prices and the material master are untouched. */
export function replaceShipmentRowImages<T extends { _rowKey?: number; material_id?: number; material_snapshot?: Material }>(
  items: readonly T[], materials: ReadonlyMap<number, Material>, keys: ReadonlySet<number>, images: readonly string[],
): T[] {
  if (!keys.size || [...keys].some(key => !items.some(item => item._rowKey === key))) throw new Error('明细已变化，请重新打开图片')
  if (images.reduce((size, image) => size + image.length, 0) > 256 * 1024) throw new Error('本行图片较多，请减少图片后再保存')
  return items.map(item => {
    if (!keys.has(item._rowKey!)) return item
    const material = materials.get(item.material_id!) || item.material_snapshot
    if (!material) throw new Error('物料资料尚未加载，请重试')
    const snapshot = withShipmentImages(material, images)
    if (!item.material_snapshot) {
      snapshot.shipment_hs_product_fallback = true
      for (const field of ['hs_cn', 'hs_id'] as const) if (!snapshot[field]) delete snapshot[field]
    }
    return { ...item, material_snapshot: snapshot }
  })
}
