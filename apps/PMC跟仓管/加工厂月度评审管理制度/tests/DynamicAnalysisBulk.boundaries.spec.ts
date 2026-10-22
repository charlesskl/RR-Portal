// Component/composable boundary behavior with only the PocketBase transport mocked.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
const m=vi.hoisted(()=>({record:{} as any,list:vi.fn(),create:vi.fn(),update:vi.fn(),listeners:[] as (()=>void)[],orders:[] as any[],patrols:[] as any[],qualityFailure:false}))
vi.mock('../src/pb',()=>({pb:{collection:(name:string)=>({getFullList:async()=>{
 if(name==='analysis_followups')return m.list()
 if(name==='factories')return [{id:'f1',name:'F1',craft:'injection',region:'dongguan'},{id:'f2',name:'F2',craft:'injection',region:'dongguan'}]
 if(name==='quality_patrols'){if(m.qualityFailure)throw Error('offline');return m.patrols}
 if(name==='orders')return m.orders
 throw Error('unexpected collection '+name)
},create:m.create,update:m.update}),authStore:{get record(){return m.record},onChange:(fn:()=>void)=>{m.listeners.push(fn);return ()=>{m.listeners=m.listeners.filter(f=>f!==fn)}}}}}))
import Panel from '../src/components/DynamicAnalysisPanel.vue'
import { chinaToday } from '../src/utils/dynamicAnalysis'
import { overdueMoreThan50 } from '../src/utils/analysisBulkResolve'
let wrappers:VueWrapper[]=[]
const order=(id:string,factory='f1')=>({id,factory,region:'dongguan',status:'pending',delivery_date:'2026-09-01',actual_delivery_date:''})
async function mounted(props={}){const w=mount(Panel,{props,global:{stubs:{AnalysisAiPanel:true,RouterLink:true}}});wrappers.push(w);await flushPromises();return w}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));vi.spyOn(window,'confirm').mockReturnValue(true);m.record={id:'owner',role:'admin',permissions:null};m.listeners=[];m.orders=[order('one')];m.patrols=[];m.qualityFailure=false;m.list.mockResolvedValue([]);m.create.mockImplementation(async(b:any)=>({id:'saved-'+b.issue_key,...b}));m.update.mockResolvedValue({})})
afterEach(()=>{wrappers.forEach(w=>w.unmount());wrappers=[];vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks()})
it.each(['orders-only','quality-only'])('allows %s authorized viewers to resolve their overdue followups despite missing-module notices',async mode=>{
 m.record.permissions=mode==='orders-only'?{'quality.view':false}:{'orders.view':false};if(mode==='quality-only')m.patrols=[{id:'patrol',factory:'f1',check_date:'2026-09-01',planned_date:'2026-09-01',correction:'synthetic correction',completed_date:''}]
 const w=await mounted();expect(w.findAll('article')).toHaveLength(1);expect(w.text()).toContain('当前账号无');expect((w.find('.bulk-actions button').element as HTMLButtonElement).disabled).toBe(false);expect((w.find('article select').element as HTMLSelectElement).disabled).toBe(false)
 await w.find('.bulk-actions button').trigger('click');await flushPromises();expect(m.create).toHaveBeenCalledTimes(1);expect(w.text()).toContain('已成功标记 1 项')
})
it('actual data-read failure also disables bulk, distinct from no-permission notices',async()=>{m.qualityFailure=true;const w=await mounted();expect(w.text()).toContain('巡查数据读取失败');expect((w.find('.bulk-actions button').element as HTMLButtonElement).disabled).toBe(true)})
it('preserves acknowledged success count and requires successful followup reload after partial failure or lost create response',async()=>{
 m.orders=[order('one'),order('two')];let saved:any[]=[];m.list.mockImplementation(async()=>saved);m.create.mockImplementation(async(body:any)=>{const row={id:'server-'+body.issue_key,...body};saved=[...saved,row];if(body.issue_key.startsWith('delivery:one:'))return row;throw Error('response lost')})
 const w=await mounted();await w.find('.bulk-actions button').trigger('click');await flushPromises();expect(w.text()).toContain('已成功标记 1 项');expect(w.text()).toContain('部分请求失败');expect(saved).toHaveLength(2)
 const disabled=()=>{expect((w.find('.bulk-actions button').element as HTMLButtonElement).disabled).toBe(true);expect(w.findAll('article select').every(s=>(s.element as HTMLSelectElement).disabled)).toBe(true)};disabled()
 await w.findAll('button').find(b=>b.text()==='立即刷新')!.trigger('click');await flushPromises();expect(m.list).toHaveBeenCalledTimes(1);disabled();await w.find('.bulk-actions button').trigger('click');expect(m.create).toHaveBeenCalledTimes(2)
 m.list.mockRejectedValueOnce(Error('followup read unavailable'));await w.findAll('button').find(b=>b.text()==='刷新跟进状态')!.trigger('click');await flushPromises();expect(w.text()).toContain('跟进状态读取失败');expect(w.text()).toContain('已成功标记 1 项');disabled()
 await w.findAll('button').find(b=>b.text()==='刷新跟进状态')!.trigger('click');await flushPromises();expect(m.list).toHaveBeenCalledTimes(3);expect(w.text()).not.toContain('跟进状态读取失败');expect(w.findAll('article select').every(s=>(s.element as HTMLSelectElement).value==='resolved')).toBe(true);expect((w.find('.bulk-actions button').element as HTMLButtonElement).disabled).toBe(true);expect(m.create).toHaveBeenCalledTimes(2)
})
it.each([['account',false],['unmount',false],['account',true],['unmount',true]] as const)('does not dispatch or report stale outcomes after %s change (failed=%s)',async(event,failed)=>{
 m.orders=Array.from({length:9},(_,i)=>order('old'+i));const pending:{body:any,resolve:(x:any)=>void,reject:(e:Error)=>void}[]=[];m.create.mockImplementation((body:any)=>new Promise((resolve,reject)=>pending.push({body,resolve,reject})));const w=await mounted();await w.find('.bulk-actions button').trigger('click');expect(m.create).toHaveBeenCalledTimes(4)
 if(event==='account'){m.record={id:'other-owner',role:'admin',permissions:null};[...m.listeners].forEach(fn=>fn());await flushPromises()}else w.unmount()
 pending.forEach(p=>failed?p.reject(Error('offline')):p.resolve({id:p.body.issue_key,...p.body}));await flushPromises();expect(m.create).toHaveBeenCalledTimes(4);expect(pending.every(p=>p.body.owner==='owner')).toBe(true);if(event==='account'){expect(w.text()).not.toContain('已成功标记');expect(w.text()).not.toContain('部分跟进状态保存失败')}
})
it('page scope is honored while the lower factory dropdown does not narrow confirmed bulk scope',async()=>{
 m.orders=[order('one','f1'),order('two','f2')];const page=await mounted({factoryId:'f1'});await page.find('.bulk-actions button').trigger('click');await flushPromises();expect(m.create.mock.calls.map(c=>c[0].issue_key)).toEqual(['delivery:one:2026-09-01']);page.unmount();m.create.mockClear()
 const global=await mounted();await global.find('.filters select').setValue('f1');expect(global.findAll('article')).toHaveLength(1);await global.find('.bulk-actions button').trigger('click');await flushPromises();expect(m.create).toHaveBeenCalledTimes(2)
})
it('strict Beijing50-day boundary crosses only at China midnight',()=>{
 const issue={kind:'delivery',date:'2026-09-02'}as any;expect(overdueMoreThan50(issue,chinaToday(new Date('2026-10-22T15:59:59Z')))).toBe(false);expect(overdueMoreThan50(issue,chinaToday(new Date('2026-10-22T16:00:00Z')))).toBe(true)
})
it('query-prop reuse continues only the originally confirmed factory snapshot, without writing the new factory',async()=>{
 m.orders=[...Array.from({length:9},(_,i)=>order('old'+i,'f1')),order('other','f2')];const pending:{body:any,resolve:(x:any)=>void}[]=[];m.create.mockImplementation((body:any)=>new Promise(resolve=>pending.push({body,resolve})));const w=await mounted({factoryId:'f1'});await w.find('.bulk-actions button').trigger('click');expect(pending).toHaveLength(4);await w.setProps({factoryId:'f2'});expect(w.findAll('article')).toHaveLength(1)
 for(let offset=0;offset<9;offset+=4){pending.slice(offset,offset+4).forEach(p=>p.resolve({id:p.body.issue_key,...p.body}));await flushPromises()}
 expect(m.create).toHaveBeenCalledTimes(9);expect(pending.every(p=>p.body.issue_key.startsWith('delivery:old'))).toBe(true)
})

it('confirmation cancellation performs no writes',async()=>{vi.mocked(window.confirm).mockReturnValue(false);const w=await mounted();await w.find('.bulk-actions button').trigger('click');await flushPromises();expect(m.create).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled()})
