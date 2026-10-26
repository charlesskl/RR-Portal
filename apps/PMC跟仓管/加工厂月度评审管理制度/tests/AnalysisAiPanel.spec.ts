import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
const mocks=vi.hoisted(()=>({send:vi.fn(),changed:null as any,record:{id:'u'} as any}))
vi.mock('../src/pb',()=>({pb:{send:mocks.send,authStore:{get record(){return mocks.record},onChange:(cb:any)=>{mocks.changed=cb;return ()=>{}}}}}))
vi.mock('../src/stores/auth',()=>({useAuthStore:()=>({role:'admin'})}))
import AnalysisAiPanel from '../src/components/AnalysisAiPanel.vue'
const response={report:{summary:'需要核实',findings:[{title:'风险',risk:'medium',analysis:'有待核实',actions:['复查'],evidence_ids:['quality_patrols:p']}],limitations:['缺少产能']},evidence:[{id:'quality_patrols:p',factoryId:'f',factoryCode:'F1',factoryName:'工厂',source:'quality_patrols',recordId:'p',date:'2026-10-16',craft:'assembly',region:'hunan'}],coverage:[],model:'test-model',start:'2026-10-01',end:'2026-10-20',generatedAt:'2026-10-20T00:00:00Z'}
const mountPanel=()=>mount(AnalysisAiPanel,{props:{factories:[]},global:{stubs:{RouterLink:{props:['to'],template:'<a><slot /></a>'}}}})
beforeEach(()=>{vi.clearAllMocks();mocks.record={id:'u'};mocks.send.mockImplementation(async(path:string)=>path.endsWith('/config')?{enabled:true,model:'test-model',reason:'',dailyLimit:20}:response)})
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
    resolve({enabled:true,model:'test-model',reason:'',dailyLimit:20});await flushPromises()
    expect(w.find('button.primary').attributes('disabled')).toBeUndefined();expect(mocks.send).toHaveBeenCalledTimes(1);w.unmount()
  })
  it('shows server failures and never substitutes a fake AI conclusion',async()=>{
    mocks.send.mockImplementation(async(path:string)=>{if(path.endsWith('/config'))return {enabled:true,model:'test-model',reason:'',dailyLimit:20};throw {response:{message:'AI服务暂不可用'}}})
    const w=mountPanel();await flushPromises();await w.find('button.primary').trigger('click');await flushPromises();expect(w.find('[role=alert]').text()).toContain('AI服务暂不可用');expect(w.find('.result').exists()).toBe(false);w.unmount()
  })
  it('discards a pending answer after authorization changes',async()=>{
    let resolve!:(value:any)=>void;mocks.send.mockImplementation((path:string)=>path.endsWith('/config')?Promise.resolve({enabled:true,model:'test-model',reason:'',dailyLimit:20}):new Promise(r=>resolve=r))
    const w=mountPanel();await flushPromises();await w.find('button.primary').trigger('click');mocks.changed();resolve(response);await flushPromises();expect(w.find('.result').exists()).toBe(false);w.unmount()
  })
})

it('replaces opaque server errors with actionable Chinese guidance',async()=>{
 mocks.send.mockImplementation(async(path:string)=>{if(path.endsWith('/config'))return {enabled:true,model:'test-model',reason:'',dailyLimit:20};throw {response:{message:'Something went wrong while processing your request.'}}})
 const w=mountPanel();await flushPromises();await w.find('button.primary').trigger('click');await flushPromises()
 expect(w.text()).toContain('请缩小日期范围或选择单个工厂后重试')
 expect(w.text()).not.toContain('Something went wrong')
 w.unmount()
})

it('retries a transient config failure once and recovers without retaining the old error',async()=>{
 mocks.send.mockRejectedValueOnce({status:503}).mockResolvedValueOnce({enabled:true,model:'qwen3-max',reason:'',dailyLimit:20})
 const w=mountPanel();await flushPromises()
 expect(mocks.send).toHaveBeenCalledTimes(2);expect(w.find('header').text()).toContain('服务已配置');expect(w.find('[role=alert]').exists()).toBe(false)
 expect(mocks.send.mock.calls.every(c=>c[0].endsWith('/config'))).toBe(true);w.unmount()
})
it('shows login expiry without retrying or misreporting missing model configuration',async()=>{
 mocks.send.mockRejectedValue({status:401})
 const w=mountPanel();await flushPromises()
 expect(mocks.send).toHaveBeenCalledTimes(1);expect(w.find('[role=alert]').text()).toContain('登录状态已失效');expect(w.find('header').text()).toContain('配置状态未知')
 await w.find('textarea').setValue('新问题');expect(w.text()).toContain('登录状态已失效');w.unmount()
})
it('clears config error after manual retry succeeds',async()=>{
 mocks.send.mockRejectedValue({status:403})
 const w=mountPanel();await flushPromises();expect(w.text()).toContain('当前账号无AI分析权限')
 mocks.send.mockResolvedValue({enabled:true,model:'qwen3-max',reason:'',dailyLimit:20})
 await w.find('[role=alert] button').trigger('click');await flushPromises()
 expect(w.find('[role=alert]').exists()).toBe(false);expect(w.find('button.primary').attributes('disabled')).toBeUndefined();w.unmount()
})
it('rejects HTML or malformed successful responses instead of displaying unconfigured service',async()=>{
 mocks.send.mockResolvedValue('<html>proxy fallback</html>')
 const w=mountPanel();await flushPromises();expect(w.text()).toContain('接口返回格式异常');expect(w.find('button.primary').attributes('disabled')).toBeDefined();w.unmount()
})
it('bounds stalled config requests and cancels them on unmount',async()=>{
 vi.useFakeTimers()
 mocks.send.mockImplementation((_path,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject({status:0,isAbort:true}))))
 const w=mountPanel();await vi.advanceTimersByTimeAsync(10000)
 expect(w.text()).toContain('请求超时或网络连接失败');expect(mocks.send).toHaveBeenCalledTimes(1)
 w.unmount();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers()
})


it('discards a late config response after switching accounts and preserves the new account config',async()=>{
 let resolveOld!:(value:any)=>void
 mocks.send.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve}))
 const w=mountPanel();await flushPromises()
 const oldSignal=mocks.send.mock.calls[0]![1].signal as AbortSignal
 mocks.record={id:'other-user'};mocks.changed();await flushPromises()
 expect(oldSignal.aborted).toBe(true);expect(mocks.send).toHaveBeenCalledTimes(2)
 expect(w.find('header').text()).toContain('服务已配置')
 resolveOld({enabled:false,model:'old-user-model',reason:'旧账号未启用',dailyLimit:20});await flushPromises()
 expect(w.text()).not.toContain('旧账号未启用')
 expect(w.find('button.primary').attributes('disabled')).toBeUndefined()
 expect(mocks.send.mock.calls.every(call=>call[0].endsWith('/config')&&call[1].method==='GET')).toBe(true)
 w.unmount()
})

it('cancels a genuinely pending config request on unmount without retrying or leaving a timer',async()=>{
 vi.useFakeTimers()
 try {
  mocks.send.mockImplementation((_path,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject({status:0,isAbort:true}))))
  const w=mountPanel();await flushPromises()
  const signal=mocks.send.mock.calls[0]![1].signal as AbortSignal
  expect(signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(1)
  w.unmount();await flushPromises()
  expect(signal.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(20000);expect(mocks.send).toHaveBeenCalledTimes(1)
 } finally {vi.useRealTimers()}
})

it.each([
 [403,'当前账号无AI分析权限',1],
 [404,'AI配置接口不存在',1],
 [429,'配置查询过于频繁',1],
 [503,'AI配置服务暂不可用',2],
 [0,'AI配置请求超时或网络连接失败',2],
])('classifies config failure %s without reporting unconfigured or retrying beyond its budget',async(status,message,count)=>{
 mocks.send.mockRejectedValue({status})
 const w=mountPanel();await flushPromises()
 expect(mocks.send).toHaveBeenCalledTimes(count)
 expect(w.find('[role=alert]').text()).toContain(message)
 expect(w.find('header').text()).toContain('配置状态未知')
 expect(w.find('header').text()).not.toContain('待配置服务')
 expect(w.find('button.primary').attributes('disabled')).toBeDefined()
 w.unmount()
})

it('cascades region and department choices, submits server scope and clears stale factory selection',async()=>{
 const w=mount(AnalysisAiPanel,{props:{factories:[{id:'h1',name:'湖南装配',region:'hunan',craft:'assembly'},{id:'h2',name:'湖南车缝',region:'hunan',craft:'sewing'},{id:'d1',name:'东莞喷油',region:'dongguan',craft:'painting'}] as any},global:{stubs:{RouterLink:true}}});await flushPromises()
 await w.find('[aria-label="分析厂区"]').setValue('hunan')
 expect(w.find('[aria-label="分析部门"]').text()).not.toContain('喷油部')
 await w.find('[aria-label="分析部门"]').setValue('assembly')
 expect(w.find('[aria-label="分析工厂"]').text()).toContain('湖南装配');expect(w.find('[aria-label="分析工厂"]').text()).not.toContain('湖南车缝')
 await w.find('button.primary').trigger('click');await flushPromises()
 expect(mocks.send.mock.calls.at(-1)![1].body).toMatchObject({region:'hunan',craft:'assembly',factory:''})
 await w.find('[aria-label="分析工厂"]').setValue('h1')
 await w.find('[aria-label="分析厂区"]').setValue('dongguan')
 expect((w.find('[aria-label="分析部门"]').element as HTMLSelectElement).value).toBe('')
 expect((w.find('[aria-label="分析工厂"]').element as HTMLSelectElement).value).toBe('')
 expect(w.find('.result').exists()).toBe(false);w.unmount()
})
