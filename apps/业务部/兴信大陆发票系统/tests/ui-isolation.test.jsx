// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import Home from '../src/pages/Home'

const urls = []
vi.stubGlobal('fetch', vi.fn(async (url) => {
  const pathname = decodeURI(new URL(url, 'http://localhost').pathname)
  urls.push(pathname)
  const bytes = readFileSync(fileURLToPath(new NodeURL(`../public${pathname}`, import.meta.url)))
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}))
afterEach(cleanup)

it('contains only Xingxin modules, loads all templates and preserves form state on navigation', async () => {
  render(<Home />)
  await waitFor(() => expect(screen.getByText(/内置空白母版（不含历史发票）/)).toBeTruthy())
  const nav = within(screen.getByRole('navigation', { name: '兴信功能模块' }))
  expect(nav.getAllByRole('button')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /^华康|^华兴|^华登/ })).toBeNull()
  const zuru = screen.getByRole('heading', { name: '兴信 ZURU 发票生成' }).closest('.min-h-screen')
  const search = zuru.querySelector('input[placeholder*="搜索"]') || zuru.querySelector('input[placeholder*="PO"]')
  expect(search).toBeTruthy()
  fireEvent.change(search, { target: { value: 'SYNTHETIC-PO' } })
  fireEvent.click(nav.getByRole('button', { name: /其他客发票/ }))
  expect(zuru.parentElement.style.display).toBe('none')
  fireEvent.click(nav.getByRole('button', { name: /^面单/ }))
  fireEvent.click(nav.getByRole('button', { name: /ZURU 发票/ }))
  expect(zuru.parentElement.style.display).toBe('')
  expect(search.value).toBe('SYNTHETIC-PO')
  await waitFor(() => expect(urls).toContain('/other-tpl/兴信香港新模板.xlsx'))
  expect(new Set(urls)).toEqual(new Set([
    '/base-master.xlsx', '/zuru-tpl/兴信-zuru.xlsx', '/miandan-tpl.xlsx',
    '/other-tpl/兴信香港.xlsx', '/other-tpl/兴信远东.xlsx', '/other-tpl/兴信香港新模板.xlsx',
  ]))
})
