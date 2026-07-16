interface PocketBaseUrlOptions {
  basePath: string
  dev: boolean
  hostname: string
  origin: string
  override?: string
}

export function resolvePocketBaseUrl(options: PocketBaseUrlOptions): string {
  if (options.override) return options.override
  if (options.dev) return `http://${options.hostname}:8091`
  return new URL(options.basePath, options.origin).toString()
}
