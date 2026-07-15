// 图片处理：压缩 + 上传到 /api/images
// 移植自旧 HTML compressImageDataUrl (5187)

import axios from 'axios'
const api = axios.create({ baseURL: '/api' })

export function compressImageDataUrl(dataUrl: string, maxDim = 400, quality = 0.75): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(null); return }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      try { resolve(canvas.toDataURL('image/jpeg', quality)) }
      catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(file)
  })
}

// Compress + upload to /api/images; returns image_id
export async function uploadImageFile(file: File, opts?: { maxDim?: number; quality?: number }): Promise<string> {
  const raw = await fileToDataUrl(file)
  const small = await compressImageDataUrl(raw, opts?.maxDim ?? 400, opts?.quality ?? 0.75)
  if (!small) throw new Error('图片压缩失败')
  const { data } = await api.post<{ id: string }>('/images', { data_url: small, mime: 'image/jpeg' })
  return data.id
}

// Compress + upload a dataURL (e.g. extracted from an Excel); returns image_id or null
export async function uploadImageDataUrl(dataUrl: string, opts?: { maxDim?: number; quality?: number }): Promise<string | null> {
  try {
    const small = await compressImageDataUrl(dataUrl, opts?.maxDim ?? 400, opts?.quality ?? 0.75)
    if (!small) return null
    const { data } = await api.post<{ id: string }>('/images', { data_url: small, mime: 'image/jpeg' })
    return data.id
  } catch { return null }
}

export function imageUrl(imageId?: string | null): string {
  if (!imageId) return ''
  return `/api/images/${encodeURIComponent(imageId)}`
}

// Fetch and return data_url for inline rendering (used when src direct fetch fails)
export async function fetchImageDataUrl(imageId: string): Promise<string | null> {
  try {
    const { data } = await api.get<{ data_url?: string }>(`/images/${encodeURIComponent(imageId)}`)
    return data.data_url ?? null
  } catch { return null }
}
