export function normalizeQuality5sHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[：:；;，,]/g, '')
    .toLowerCase()
}

export function quality5sColumnOf(header: unknown[], ...aliases: string[]): number {
  const normalized = header.map(normalizeQuality5sHeader)
  for (const alias of aliases) {
    const target = normalizeQuality5sHeader(alias)
    const index = normalized.indexOf(target)
    if (index >= 0) return index
  }
  return -1
}

export function quality5sImportDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return String(value ?? '').trim().slice(0, 10)
}
