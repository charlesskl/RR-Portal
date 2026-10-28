// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import * as engine from '../src/lib/engine.js';
import Home from '../src/pages/Home';
import { date, intlSheet, workbookBuffer } from './fixtures.js';

vi.stubGlobal('fetch', vi.fn(async (url) => {
  const pathname = decodeURI(new URL(url, 'http://localhost').pathname);
  const bytes = readFileSync(fileURLToPath(new NodeURL(`../public${pathname}`, import.meta.url)));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('selects same-number invoices independently and exports each customer from its own source list', async () => {
  const jaz = [['JAZWARES LLC', null, null, null, null, null, null, null, null, '99100'],
    [], [null, null, null, null, null, null, date()], [null, 'PO NO:TEST-JAZ'], [],
    ['TEST-JAZ-SKU', 'Synthetic goods', null, null, null, 2, null, null, 5, null, 10],
    [null, null, null, null, null, null, null, null, null, null, 10],
    [null, 'BANK NAME']];
  const buffer = workbookBuffer({ '99100': jaz, '99100折': intlSheet({ inv: '99100' }) });
  const generate = vi.spyOn(engine, 'generate');
  render(<Home />);
  await screen.findByText('ZURU 兴信新模板已加载');
  fireEvent.change(screen.getByLabelText('ZURU源表上传'), { target: { files: [{ name: 'synthetic-customers.xlsx', arrayBuffer: async () => buffer }] } });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  const [first, second] = screen.getAllByRole('checkbox');
  expect(first.checked).toBe(true); expect(second.checked).toBe(true);
  fireEvent.click(first);
  expect(first.checked).toBe(false); expect(second.checked).toBe(true);
  expect(screen.getByRole('button', { name: '生成 1 张发票', exact: true })).toBeTruthy();
  fireEvent.click(first);
  fireEvent.click(screen.getByRole('button', { name: '生成 2 张发票', exact: true }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  const calls = generate.mock.calls.map(([args]) => args);
  expect(calls.map((args) => args.invoices.map((invoice) => invoice.customer))).toEqual([['JAZ'], ['ZURU']]);
  for (const args of calls) expect([...args.selected]).toEqual(['99100']);
  await screen.findByRole('button', { name: /下载 JAZ 工作簿/ });
  await screen.findByRole('button', { name: '⬇ 下载工作簿', exact: true });
});
