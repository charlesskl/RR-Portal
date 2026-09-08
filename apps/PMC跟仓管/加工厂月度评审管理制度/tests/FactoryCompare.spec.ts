import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import FactoryCompare from '../src/components/FactoryCompare.vue'

const state = vi.hoisted(() => ({ loads: 0, waitForLoad: null as Promise<void> | null, writeFile: vi.fn() }))

vi.mock('../src/stores/factories', () => ({
  useFactoriesStore: () => ({ items: [
    { id: 'factory-a', name: '工厂甲', craft: 'injection' },
    { id: 'factory-b', name: '工厂乙', craft: 'injection' },
    { id: 'factory-c', name: '工厂丙', craft: 'injection' },
  ], fetchAll: vi.fn() }),
}))
vi.mock('../src/pb', () => ({ pb: { collection: (name: string) => ({
  getFullList: vi.fn().mockResolvedValue(name === 'monthly_scores' ? [
    { factory: 'factory-a', year_month: '2026-07', grade: 'A' },
    { factory: 'factory-b', year_month: '2026-07', grade: 'C' },
    { factory: 'factory-b', year_month: '2026-08', grade: 'A' },
    { factory: 'factory-c', year_month: '2026-08', grade: 'B' },
  ] : []),
}) } }))
vi.mock('xlsx-js-style', async (importOriginal) => {
  state.loads++
  await state.waitForLoad
  const original = await importOriginal<typeof import('xlsx-js-style')>()
  return { default: { ...original.default, writeFile: state.writeFile } }
})

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount() })

it('snapshots values and highlights before a slow Excel load, and allows retry after failure', async () => {
  let release!: () => void
  state.waitForLoad = new Promise<void>((resolve) => { release = resolve })
  state.writeFile.mockImplementationOnce(() => { throw new Error('Save failed') })
  wrapper = mount(FactoryCompare, { props: { month: '2026-07' } })
  expect(state.loads).toBe(0)
  await wrapper.get('input.kw').trigger('focus')
  await wrapper.get('.dropdown li').trigger('mousedown')
  await flushPromises()
  await wrapper.get('input.kw').trigger('focus')
  await wrapper.get('.dropdown li').trigger('mousedown')
  await flushPromises()
  expect(state.loads).toBe(0)

  const button = wrapper.get('.cmp-head button')
  void button.trigger('click')
  await nextTick()
  expect(button.text()).toBe('导出中…')
  expect(button.attributes('disabled')).toBeDefined()

  // The user moves to another month and replaces the first factory while the library is loading.
  await wrapper.setProps({ month: '2026-08' })
  await flushPromises()
  await wrapper.findAll('.chip .x')[0]!.trigger('click')
  await wrapper.get('input.kw').trigger('focus')
  await wrapper.findAll('.dropdown li')[1]!.trigger('mousedown')
  await flushPromises()
  release()
  await vi.waitFor(() => expect(state.writeFile).toHaveBeenCalledOnce())
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('导出失败')
  expect(button.attributes('disabled')).toBeUndefined()
  const originalSheet = state.writeFile.mock.calls[0]![0].Sheets['工厂对比']
  expect(originalSheet.B1.v).toBe('工厂甲')
  expect(originalSheet.C1.v).toBe('工厂乙')
  const gradeRow = Object.keys(originalSheet).find((address) => /^A\d+$/.test(address) && originalSheet[address].v === '工厂评级')!.slice(1)
  expect(originalSheet[`B${gradeRow}`].v).toBe('A')
  expect(originalSheet[`C${gradeRow}`].v).toBe('C')
  expect(originalSheet[`B${gradeRow}`].s.fill.fgColor.rgb).toBe('E8F7EE')
  expect(originalSheet[`C${gradeRow}`].s.fill).toBeUndefined()

  await button.trigger('click')
  await vi.waitFor(() => expect(state.writeFile).toHaveBeenCalledTimes(2))
  await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  const [workbook, filename] = state.writeFile.mock.calls[1]!
  expect(filename).toBe('工厂对比表.xlsx')
  expect(workbook.Sheets['工厂对比'].B1.v).toBe('工厂乙')
  expect(workbook.Sheets['工厂对比'].C1.v).toBe('工厂丙')
  expect(workbook.Sheets['工厂对比'][`B${gradeRow}`].v).toBe('A')
  expect(workbook.Sheets['工厂对比'][`C${gradeRow}`].v).toBe('B')
  expect(workbook.Sheets['工厂对比'].A1.s.font.bold).toBe(true)
  expect(workbook.Sheets['工厂对比']['!merges']).toHaveLength(6)
})
