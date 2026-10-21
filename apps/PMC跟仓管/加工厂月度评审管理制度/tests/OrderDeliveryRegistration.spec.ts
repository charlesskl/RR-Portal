import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import OrderDetailView from '../src/views/OrderDetailView.vue'
const state=vi.hoisted(()=>({update:vi.fn(),get:vi.fn()}))
vi.mock('../src/pb',()=>({pb:{collection:()=>({getOne:state.get})}}))
vi.mock('../src/stores/orders',()=>({useOrdersStore:()=>({update:state.update})}))
vi.mock('../src/stores/auth',()=>({useAuthStore:()=>({role:'admin'})}))
vi.mock('../src/utils/permissions',()=>({canEditOrders:()=>true}))
vi.mock('../src/components/AppLayout.vue',()=>({default:{template:'<main><slot /></main>'}}))
vi.mock('vue-router',()=>({useRoute:()=>({params:{craft:'assembly',id:'o1'},query:{reminder:'delivery'}}),RouterLink:{template:'<a><slot /></a>'}}))
beforeEach(()=>{vi.clearAllMocks();state.get.mockResolvedValue({id:'o1',product:'产品',pmc:'PMC甲',actual_delivery_date:'',expand:{factory:{name:'甲厂'}}});state.update.mockResolvedValue({id:'o1',actual_delivery_date:'2026-10-21'});HTMLElement.prototype.scrollIntoView=vi.fn()})
describe('original-order delivery registration',()=>{
  it('saves the explicitly entered actual date without guessing delivered status',async()=>{
    const w=mount(OrderDetailView,{attachTo:document.body});await flushPromises()
    const panel=w.find('#delivery-registration')
    expect(panel.text()).toContain('请核实是否已交付')
    await panel.find('input[type=date]').setValue('2026-10-21');await panel.find('form').trigger('submit');await flushPromises()
    expect(state.update).toHaveBeenCalledWith('o1',expect.objectContaining({actual_delivery_date:'2026-10-21'}))
    expect(state.update.mock.calls[0][1]).not.toHaveProperty('status')
    expect(panel.find('.ok').exists()).toBe(true);w.unmount()
  })
  it('retains an unsaved date and enables retry on failure',async()=>{
    state.update.mockRejectedValueOnce(new Error('offline'))
    const w=mount(OrderDetailView,{attachTo:document.body});await flushPromises()
    const panel=w.find('#delivery-registration')
    await panel.find('input[type=date]').setValue('2026-10-20');await panel.find('form').trigger('submit');await flushPromises()
    expect(panel.find('[role=alert]').text()).toContain('保存失败')
    expect(panel.find('button').attributes('disabled')).toBeUndefined()
    expect((panel.find('input[type=date]').element as HTMLInputElement).value).toBe('2026-10-20')
    expect(panel.find('.ok').exists()).toBe(false);w.unmount()
  })
})
