import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
const mocks=vi.hoisted(()=>({send:vi.fn(),changed:null as any}))
vi.mock('../src/pb',()=>({pb:{send:mocks.send,authStore:{record:{id:'u'},onChange:(cb:any)=>{mocks.changed=cb;return ()=>{}}}}}))
vi.mock('../src/stores/auth',()=>({useAuthStore:()=>({role:'admin'})}))
import AnalysisAiPanel from '../src/components/AnalysisAiPanel.vue'
const response={report:{summary:'需要核实',findings:[{title:'风险',risk:'medium',analysis:'有待核实',actions:['复查'],evidence_ids:['quality_patrols:p']}],limitations:['缺少产能']},evidence:[{id:'quality_patrols:p',factoryId:'f',factoryCode:'F1',factoryName:'工厂',source:'quality_patrols',recordId:'p',date:'2026-10-16',craft:'assembly',region:'hunan'}],coverage:[],model:'test-model',start:'2026-10-01',end:'2026-10-20',generatedAt:'2026-10-20T00:00:00Z'}
const mountPanel=()=>mount(AnalysisAiPanel,{props:{factories:[]},global:{stubs:{RouterLink:{props:['to'],template:'<a><slot /></a>'}}}})
beforeEach(()=>{vi.clearAllMocks();mocks.send.mockImplementation(async(path:string)=>path.endsWith('/config')?{enabled:true,model:'test-model',reason:'',dailyLimit:20}:response)})
describe('AI analysis interaction',()=>{
  it('does not issue a paid request without configuration and shows the admin entry',async()=>{
    mocks.send.mockResolvedValue({enabled:false,model:'',reason:'AI服务尚未启用',dailyLimit:20})
    const w=mountPanel();await flushPromises();expect(w.find('button.primary').attributes('disabled')).toBeDefined();expect(w.text()).toContain('AI服务配置入口');expect(mocks.send).toHaveBeenCalledTimes(1);w.unmount()
  })
  it('requires an explicit click, renders evidence and clears stale answers on scope changes',async()=>{
    const w=mountPanel();await flushPromises();expect(mocks.send).toHaveBeenCalledTimes(1)
    await w.find('button.primary').trigger('click');await flushPromises();expect(w.text()).toContain('F1＝工厂');expect(w.text()).toContain('缺少产能');expect(w.findAll('article a')).toHaveLength(1)
    expect(mocks.send.mock.calls[1]![1].body).not.toHaveProperty('records')
    await w.find('textarea').setValue('其他分析问题');expect(w.find('.result').exists()).toBe(false);w.unmount()
  })
  it('keeps configuration loading independent from edits to the analysis question',async()=>{
    let resolve!:(value:any)=>void;mocks.send.mockImplementation(()=>new Promise(r=>resolve=r))
    const w=mountPanel();await w.find('textarea').setValue('正在输入分析问题')
    resolve({enabled:true,model:'test-model'});await flushPromises()
    expect(w.find('button.primary').attributes('disabled')).toBeUndefined();expect(mocks.send).toHaveBeenCalledTimes(1);w.unmount()
  })
  it('shows server failures and never substitutes a fake AI conclusion',async()=>{
    mocks.send.mockImplementation(async(path:string)=>{if(path.endsWith('/config'))return {enabled:true};throw {response:{message:'AI服务暂不可用'}}})
    const w=mountPanel();await flushPromises();await w.find('button.primary').trigger('click');await flushPromises();expect(w.find('[role=alert]').text()).toContain('AI服务暂不可用');expect(w.find('.result').exists()).toBe(false);w.unmount()
  })
  it('discards a pending answer after authorization changes',async()=>{
    let resolve!:(value:any)=>void;mocks.send.mockImplementation((path:string)=>path.endsWith('/config')?Promise.resolve({enabled:true}):new Promise(r=>resolve=r))
    const w=mountPanel();await flushPromises();await w.find('button.primary').trigger('click');mocks.changed();resolve(response);await flushPromises();expect(w.find('.result').exists()).toBe(false);w.unmount()
  })
})
