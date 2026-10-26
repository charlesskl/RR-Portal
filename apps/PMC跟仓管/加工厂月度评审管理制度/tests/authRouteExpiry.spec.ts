import { beforeEach, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({guard:null as any,valid:true,auth:{isLoggedIn:true,role:'admin',logout:vi.fn()}}))
vi.mock('vue-router',()=>({createWebHistory:vi.fn(),createRouter:()=>({beforeEach:(fn:any)=>m.guard=fn,onError:vi.fn()})}))
vi.mock('../src/pb',()=>({pb:{authStore:{get isValid(){return m.valid}}}}))
vi.mock('../src/stores/auth',()=>({useAuthStore:()=>m.auth}))
import '../src/router'
beforeEach(()=>{vi.clearAllMocks();m.valid=true;m.auth.isLoggedIn=true})
it('rejects cached user identity when token is expired',()=>{
 m.valid=false
 expect(m.guard({path:'/analysis',meta:{},params:{},query:{}})).toBe('/login')
 expect(m.auth.logout).toHaveBeenCalledOnce()
})
it('rechecks expiration on each navigation',()=>{
 const route={path:'/analysis',meta:{},params:{},query:{}}
 expect(m.guard(route)).toBe(true);m.valid=false;expect(m.guard(route)).toBe('/login')
})
it('allows valid sessions and public login page',()=>{
 expect(m.guard({path:'/analysis',meta:{},params:{},query:{}})).toBe(true)
 m.valid=false
 expect(m.guard({path:'/login',meta:{public:true},params:{},query:{}})).toBe(true)
 expect(m.auth.logout).not.toHaveBeenCalled()
})
