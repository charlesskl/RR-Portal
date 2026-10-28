/** Load packaged blank templates relative to the app, including portal subpaths. */
const cache = new Map()

export function loadAsset(path) {
  if (cache.has(path)) return cache.get(path)
  const result = (async () => {
    const url = new URL(path.replace(/^\/+/, ''), document.baseURI)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`内置模板加载失败：${path} (${response.status})`)
    return response.arrayBuffer()
  })()
  cache.set(path, result)
  // A temporary request failure should not poison subsequent attempts.
  result.catch(() => cache.delete(path))
  return result
}
