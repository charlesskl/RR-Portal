export function publicBase(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}

export function apiBase(baseUrl: string): string {
  return `${publicBase(baseUrl)}/api`
}

export function publicAsset(baseUrl: string, fileName: string): string {
  return `${publicBase(baseUrl)}/${fileName.replace(/^\/+/, '')}`
}
