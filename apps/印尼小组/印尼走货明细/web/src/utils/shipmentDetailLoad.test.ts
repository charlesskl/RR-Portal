import { expect, it, vi } from 'vitest'
import { loadShipmentDetail, loadShipmentMaterials } from './shipmentDetailLoad'

const page = (offset: number, count: number, total = 3, version = 'same') => ({ data: {
  id: 23, customer: 'RRI', items: Array.from({ length: count }, (_, i) => ({ id: offset + i, material_snapshot: { name_zh: '合成物料' } })),
  items_offset: offset, items_total: total, items_version: version, items_next_offset: offset + count < total ? offset + count : null,
} })

it('按服务器字节预算返回的实际条数推进，全部读取同一版本后才返回整单', async () => {
  const read = vi.fn().mockResolvedValueOnce(page(0, 2)).mockResolvedValueOnce(page(2, 1))
  const result = await loadShipmentDetail(read, 23, () => true)
  expect(result?.items).toHaveLength(3)
  expect(read.mock.calls.map(([params]) => params)).toEqual([{ offset: 0, limit: 10 }, { offset: 2, limit: 10, version: 'same' }])
})

it('后续页失败不能返回半张单，切换单据后停止发出后续分页', async () => {
  const read = vi.fn().mockResolvedValueOnce(page(0, 2)).mockRejectedValueOnce(new Error('Network Error'))
  await expect(loadShipmentDetail(read, 23, () => true)).rejects.toThrow('Network Error')
  const stale = vi.fn().mockResolvedValue(page(0, 2))
  expect(await loadShipmentDetail(stale, 23, () => false)).toBeNull()
  expect(stale).toHaveBeenCalledOnce()
})

it.each([
  { ...page(2, 1).data, items_version: 'changed' },
  { ...page(2, 1).data, items_total: 4 },
  { ...page(2, 1).data, items_offset: 0 },
  { ...page(2, 1).data, items: [] },
  { ...page(2, 1).data, items: [{ id: 0 }] },
  { ...page(2, 1).data, items_next_offset: 2 },
  { ...page(2, 1).data, id: 24 },
])('拒绝并发修改、缺页、错页和重复明细，保持编辑保护', async data => {
  const read = vi.fn().mockResolvedValueOnce(page(0, 2)).mockResolvedValueOnce({ data })
  await expect(loadShipmentDetail(read, 23, () => true)).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(2)
})

it('兼容旧服务完整响应，合法空单也能完成加载', async () => {
  const legacy = { data: { id: 23, items: [{ id: 9 }] } }, read = vi.fn().mockResolvedValue(legacy)
  expect(await loadShipmentDetail(read, 23, () => true)).toEqual(legacy.data)
  expect(await loadShipmentDetail(vi.fn().mockResolvedValue(page(0, 0, 0)), 23, () => true)).toMatchObject({ items: [] })
})

it('物料图片只按每批10条串行读取，不因后批失败发布不完整资料', async () => {
  const ids = Array.from({ length: 23 }, (_, i) => i + 1)
  const read = vi.fn(async (batch: number[]) => ({ data: batch.map(id => ({ id })) }))
  expect(await loadShipmentMaterials(ids, read, () => true)).toHaveLength(23)
  expect(read.mock.calls.map(([batch]) => batch.length)).toEqual([10, 10, 3])
  read.mockResolvedValueOnce({ data: [] })
  await expect(loadShipmentMaterials(ids, read, () => true)).rejects.toThrow('未完整加载')
})
