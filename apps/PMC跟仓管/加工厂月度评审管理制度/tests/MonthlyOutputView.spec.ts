import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import MonthlyOutputView from '../src/views/MonthlyOutputView.vue'
const state = vi.hoisted(()=>({fetch:vi.fn(), range:vi.fn(), save:vi.fn(), factoryFetch:vi.fn(), factoryStore:null as any, authCallback:null as null | (()=>void), authUnsubscribe:vi.fn(), factories:[
  {id:'a',name:'甲厂',craft:'sewing',region:'hunan'},
  {id:'b',name:'乙厂',craft:'assembly',region:'dongguan'},
  {id:'x',name:'无权限工厂',craft:'injection',region:'heyuan'},
]}))
vi.mock('../src/pb',()=>({pb:{authStore:{onChange:(callback:()=>void)=>{state.authCallback=callback;return state.authUnsubscribe}}}}))
vi.mock('../src/stores/auth',()=>({useAuthStore:()=>({userId:'admin',role:'admin'})}))
vi.mock('../src/utils/permissions',()=>({allowedCrafts:()=>['sewing','assembly'],allowedRegions:()=>['hunan','dongguan']}))
vi.mock('../src/stores/orders',()=>({useOrdersStore:()=>({fetchAll:state.fetch})}))
vi.mock('../src/stores/output',()=>({useOutputStore:()=>({fetchByRange:state.range,upsert:state.save})}))
vi.mock('../src/stores/factories',async()=>{
  const { reactive } = await import('vue')
  const store=reactive({items:state.factories,fetchAll:()=>state.factoryFetch()})
  state.factoryStore=store
  return {useFactoriesStore:()=>store}
})
vi.mock('../src/components/AppLayout.vue',()=>({default:{template:'<main><slot /></main>'}}))
let wrapper: ReturnType<typeof mount>
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-21T05:00:00Z'));vi.clearAllMocks()
  state.factoryStore.items=state.factories
  state.factoryFetch.mockImplementation(async()=>{state.factoryStore.items=state.factories;return state.factories})
  state.fetch.mockResolvedValue([
    {factory:'a',order_date:'2026-01-01',amount:100.25},
    {factory:'a',order_date:'2026-03-31',amount:200.5},
    {factory:'a',order_date:'2026-10-01',amount:400.75},
    {factory:'b',order_date:'2026-02-01',amount:50},
    {factory:'x',order_date:'2026-02-01',amount:9000},
  ])
  state.range.mockImplementation(async(start:string,end:string)=>[
    {factory:'a',year_month:'2026-01',source_doc:'JAN'},
    {factory:'a',year_month:'2026-03',source_doc:'MAR'},
    {factory:'a',year_month:'2026-10',source_doc:'OCT'},
  ].filter(r=>r.year_month>=start&&r.year_month<=end))
  state.save.mockResolvedValue({})
})
afterEach(()=>{wrapper?.unmount();vi.useRealTimers();vi.restoreAllMocks()})
async function setup(){wrapper=mount(MonthlyOutputView);await flushPromises();return wrapper}
describe('产值期间查询',()=>{
  it('clears its private snapshots immediately when authentication changes',async()=>{
    const w=await setup()
    expect(w.find('table').exists()).toBe(true)
    state.authCallback!();await flushPromises()
    expect(w.find('table').exists()).toBe(false)
    expect(w.find('[role=alert]').text()).toContain('账号或权限已变更')
    expect(w.find('button.ghost').attributes('disabled')).toBeDefined()
    w.unmount()
    expect(state.authUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('keeps fractional-cent order totals when saving a month and rounds only display',async()=>{
    state.fetch.mockResolvedValue([
      {factory:'a',order_date:'2026-10-01',amount:.004},
      {factory:'a',order_date:'2026-10-02',amount:.004},
      {factory:'b',order_date:'2026-10-03',amount:.004},
    ])
    const w=await setup()
    expect(w.find('.period-summary').text()).toContain('0.01')
    await w.findAll('tbody button')[0]!.trigger('click');await flushPromises()
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({factory:'a',monthly_amount:.008}))
  })
  it('adds raw amounts across factories before formatting the displayed total',async()=>{
    state.fetch.mockResolvedValue([
      {factory:'a',order_date:'2026-10-01',amount:.004},
      {factory:'b',order_date:'2026-10-02',amount:.004},
    ])
    const w=await setup()
    expect(w.findAll('tbody .amount').map(td=>td.text())).toEqual(['0.00','0.00'])
    expect(w.find('.period-summary').text()).toContain('0.01')
    expect(w.find('tfoot').text()).toContain('0.01')
  })
  it('keeps the complete factory snapshot when a shared store receives an older response',async()=>{
    const w=await setup()
    const original = state.factories
    let resolve!:(value:any)=>void
    state.factoryFetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
    await w.find('[aria-label="查询方式"]').setValue('quarter')
    const current = state.factories.map(f=>({...f,name:f.id==='a'?'新甲厂':f.name}))
    state.factoryFetch.mockImplementationOnce(async()=>{state.factoryStore.items=current;return current})
    await w.find('[aria-label="查询方式"]').setValue('year');await flushPromises()
    expect(w.find('tbody').text()).toContain('新甲厂')
    // factories.fetchAll assigns its store before this page's request guard runs.
    state.factoryStore.items = [{id:'stale',name:'旧查询工厂',craft:'sewing',region:'hunan'}]
    resolve(state.factoryStore.items);await flushPromises()
    expect(w.find('tbody').text()).toContain('新甲厂')
    expect(w.find('tbody').text()).not.toContain('旧查询工厂')
    state.factories = original
  })
  it('recovers a failed load on retry and permits a failed save to be retried',async()=>{
    state.fetch.mockRejectedValueOnce(new Error('offline'))
    const w=await setup()
    expect(w.find('[role=alert]').text()).toContain('加载失败')
    await w.findAll('.toolbar button')[0]!.trigger('click');await flushPromises()
    expect(w.find('table').exists()).toBe(true)
    state.save.mockRejectedValueOnce(new Error('save offline'))
    await w.findAll('tbody button')[0]!.trigger('click');await flushPromises()
    expect(w.find('[role=status]').text()).toContain('保存失败')
    await w.findAll('tbody button')[0]!.trigger('click');await flushPromises()
    expect(w.find('[role=status]').text()).toContain('已保存')
    expect(state.save).toHaveBeenCalledTimes(2)
  })

  it('keeps monthly saving separate from quarter/year totals and filters the total',async()=>{
    const w=await setup()
    expect(w.find('.period-summary').text()).toContain('400.75')
    await w.find('input[placeholder="对账单号"]').setValue('NEW')
    await w.findAll('tbody button')[0]!.trigger('click');await flushPromises()
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({year_month:'2026-10',monthly_amount:400.75,source_doc:'NEW'}))
    await w.find('[aria-label="查询方式"]').setValue('quarter');await w.find('[aria-label="季度"]').setValue(1);await flushPromises()
    expect(state.range).toHaveBeenLastCalledWith('2026-01','2026-03')
    expect(w.find('.period-summary').text()).toContain('350.75')
    expect(w.find('tbody').text()).toContain('2026-01：JAN')
    expect(w.find('tbody').text()).toContain('2026-03：MAR')
    expect(w.find('tbody').text()).not.toContain('无权限工厂')
    expect(w.find('tbody button').exists()).toBe(false)
    await w.find('[aria-label="厂区"]').setValue('hunan')
    expect(w.find('.period-summary').text()).toContain('300.75')
    await w.find('[aria-label="查询方式"]').setValue('year');await flushPromises()
    expect(w.find('.period-summary').text()).toContain('701.50')
  })
  it('rejects invalid custom periods, clears stale results, and presents load errors',async()=>{
    const w=await setup()
    await w.find('[aria-label="查询方式"]').setValue('custom')
    await w.find('[aria-label="开始月份"]').setValue('2026-12');await flushPromises()
    expect(w.find('[role=alert]').text()).toContain('不能晚于')
    expect(w.find('table').exists()).toBe(false)
    expect(w.find('button.ghost').attributes('disabled')).toBeDefined()
    state.fetch.mockRejectedValueOnce(new Error('offline'))
    await w.find('[aria-label="结束月份"]').setValue('2027-02');await flushPromises()
    expect(w.find('[role=alert]').text()).toContain('加载失败')
    expect(w.find('table').exists()).toBe(false)
  })
  it('ignores late results from an older query',async()=>{
    const w=await setup()
    let resolve!:(value:any)=>void
    state.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
    await w.find('[aria-label="查询方式"]').setValue('quarter')
    await w.find('[aria-label="查询方式"]').setValue('year');await flushPromises()
    expect(w.find('.period-summary').text()).toContain('751.50')
    resolve([{factory:'a',order_date:'2026-10-01',amount:999}]);await flushPromises()
    expect(w.find('.period-summary').text()).toContain('751.50')
  })
  it('exports the queried range, visible factories and period amounts',async()=>{
    const w=await setup()
    await w.find('[aria-label="查询方式"]').setValue('year');await flushPromises()
    await w.find('[placeholder="搜索工厂 / 部门"]').setValue('甲厂')
    let blob!:Blob;let filename=''
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn((b:Blob)=>{blob=b;return 'blob:fixture'})})
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){filename=this.download})
    await w.find('button.ghost').trigger('click')
    const text=await blob.text()
    expect(filename).toBe('产值_2026-01_2026-12.csv')
    expect(text).toContain('"2026-01","2026-12","甲厂"')
    expect(text).toContain('701.5');expect(text).not.toContain('乙厂')
  })
})
