import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DeliveryReminder from '../src/components/DeliveryReminder.vue'
import { deliveryReminderPage } from '../src/utils/deliveryReminder'
const state=vi.hoisted(()=>({send:vi.fn(),auth:{userId:'u1',role:'admin'},route:{path:'/orders'},listener:()=>{},unsub:vi.fn()}))
vi.mock('../src/pb',()=>({pb:{send:state.send,authStore:{onChange:(cb:()=>void)=>{state.listener=cb;return state.unsub}}}}))
vi.mock('../src/stores/auth',async()=>{const {reactive}=await import('vue');return {useAuthStore:()=>reactive(state.auth)}})
vi.mock('vue-router',async()=>{const {reactive}=await import('vue');return {useRoute:()=>reactive(state.route),RouterLink:{props:['to'],template:'<a :href="to.path"><slot /></a>'}}})
vi.mock('../src/utils/permissions',()=>({canViewOrders:()=>true,canEditOrders:()=>true}))
const item={id:'o1',factoryName:'甲厂',craft:'assembly',region:'hunan',orderNo:'O-001',product:'产品',dueDate:'2026-10-21'}
const result={today:'2026-10-21',items:[item],hasMore:false,nameAmbiguous:false}
let w:ReturnType<typeof mount>
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-21T02:00:00Z'));vi.clearAllMocks();state.auth.userId='u1';state.route.path='/orders';const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)});Object.defineProperty(document,'hidden',{configurable:true,value:false});state.send.mockResolvedValue(result)})
afterEach(()=>{w?.unmount();document.body.innerHTML='';vi.useRealTimers();vi.unstubAllGlobals()})
async function setup(){w=mount(DeliveryReminder,{attachTo:document.body});await flushPromises();return w}
describe('delivery registration reminders',()=>{
  it('only enables reminders on delivery list pages, not detail forms or other modules',()=>{
    for(const path of ['/orders','/orders/dept/assembly','/orders/region/hunan/delayed'])expect(deliveryReminderPage(path)).toBe(true)
    for(const path of ['/dashboard','/orders/new','/orders/dept/assembly/new','/orders/dept/assembly/o1'])expect(deliveryReminderPage(path)).toBe(false)
  })
  it('opens automatically, links to registration, snoozes one hour and remains manually accessible',async()=>{
    await setup();expect(w.find('[role=dialog]').text()).toContain('今天到期')
    expect(w.find('a').attributes('href')).toBe('/orders/dept/assembly/o1')
    await w.find('[role=dialog] button').trigger('click');expect(w.find('[role=dialog]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(60000);await flushPromises();expect(w.find('[role=dialog]').exists()).toBe(false)
    await w.find('.delivery-notice button').trigger('click');expect(w.find('[role=dialog]').exists()).toBe(true)
    await w.find('[role=dialog] button').trigger('click');await vi.advanceTimersByTimeAsync(3600000);await flushPromises()
    expect(w.find('[role=dialog]').exists()).toBe(true)
  })
  it('does not interrupt input and removes the reminder after registration',async()=>{
    const input=document.createElement('input');document.body.append(input);input.focus()
    await setup();expect(w.find('[role=dialog]').exists()).toBe(false)
    input.blur();await vi.advanceTimersByTimeAsync(60000);await flushPromises();expect(w.find('[role=dialog]').exists()).toBe(true)
    state.send.mockResolvedValue({...result,items:[]});await vi.advanceTimersByTimeAsync(60000);await flushPromises()
    expect(w.find('[role=dialog]').exists()).toBe(false);expect(w.find('.delivery-notice').exists()).toBe(false)
  })
  it('discards late responses across account changes and cleans up timers',async()=>{
    let resolve!:(value:any)=>void
    state.send.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await setup()
    const {useAuthStore}=await import('../src/stores/auth');useAuthStore().userId='u2';state.listener();state.send.mockResolvedValue({...result,items:[]});await flushPromises()
    resolve(result);await flushPromises();expect(w.find('[role=dialog]').exists()).toBe(false)
    w.unmount();expect(state.unsub).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0)
  })
  it('does not poll hidden pages and shows retry on an unavailable feed',async()=>{
    state.send.mockRejectedValueOnce(new Error('offline'));await setup();expect(w.find('[role=status]').text()).toContain('读取失败')
    Object.defineProperty(document,'hidden',{configurable:true,value:true});await vi.advanceTimersByTimeAsync(120000);expect(state.send).toHaveBeenCalledTimes(1)
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));await flushPromises()
    expect(w.find('[role=dialog]').exists()).toBe(true)
  })
  it('handles ambiguous names without inventing an empty successful reminder',async()=>{
    state.send.mockResolvedValue({...result,items:[],nameAmbiguous:true});await setup();expect(w.text()).toContain('无法唯一匹配');expect(w.find('[role=dialog]').exists()).toBe(false)
  })
})
