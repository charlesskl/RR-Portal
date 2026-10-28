// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const atPath = (path) => {
  const base = document.createElement('base')
  base.href = `http://localhost${path}`
  document.head.append(base)
}
afterEach(() => { document.querySelector('base')?.remove(); vi.unstubAllGlobals(); vi.resetModules() })

it.each(['/', '/xingxin-invoice/'])('loads templates under the current app path %s', async (path) => {
  atPath(path)
  const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
  vi.stubGlobal('fetch', fetch)
  const { loadAsset } = await import('../src/lib/loadAsset.js')
  const first = loadAsset('/other-tpl/兴信香港.xlsx')
  expect(loadAsset('/other-tpl/兴信香港.xlsx')).toBe(first)
  await first
  expect(decodeURI(fetch.mock.calls[0][0].href)).toBe(`http://localhost${path}other-tpl/兴信香港.xlsx`)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('allows retry after a failed request', async () => {
  atPath('/xingxin-invoice/')
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
  vi.stubGlobal('fetch', fetch)
  const { loadAsset } = await import('../src/lib/loadAsset.js')
  await expect(loadAsset('/base-master.xlsx')).rejects.toThrow('503')
  expect(await loadAsset('/base-master.xlsx')).toBeInstanceOf(ArrayBuffer)
  expect(fetch).toHaveBeenCalledTimes(2)
})
