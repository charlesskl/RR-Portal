"use client";
import { createContext,useCallback,useContext,useEffect,useMemo,useState } from "react";
import { usePathname,useRouter } from "next/navigation";
import { defaultPermissions,hasPermission,normalizeLoginName,routePermission,type Permission,type PublicUser,type ToyQMSUser,type UserCategory } from "@/lib/auth";
import { apiFetch,ensureReachableBackend,getRemoteToken,setRemoteToken } from "@/lib/backend";
import { hashPasswordCompat,randomId,randomSaltBase64 } from "@/lib/crypto-fallback";

const USERS_KEY="toyqms.users.v1",SESSION_KEY="toyqms.session.v1",DEFAULT_PASSWORD="12345678";
// http 非安全上下文没有 crypto.subtle/randomUUID，一律走 crypto-fallback（#651）
const hashPassword=hashPasswordCompat;
async function passwordFields(password:string){const salt=randomSaltBase64();return {passwordSalt:salt,passwordHash:await hashPassword(password,salt)}}
const publicUser=(user:ToyQMSUser):PublicUser=>{const {passwordHash:_hash,passwordSalt:_salt,...safe}=user;return safe};

type CreateUserInput={name:string;responsibility:string;loginName:string;category:UserCategory;permissions?:Permission[]};
type UpdateUserInput=Partial<Pick<ToyQMSUser,"name"|"responsibility"|"loginName"|"category"|"permissions"|"enabled">>;
type AuthValue={loading:boolean;user:PublicUser|null;users:PublicUser[];login:(loginName:string,password:string)=>Promise<PublicUser>;logout:()=>void;changeOwnPassword:(currentPassword:string,newPassword:string)=>Promise<void>;createUser:(input:CreateUserInput)=>Promise<void>;updateUser:(id:string,input:UpdateUserInput)=>Promise<void>;resetPassword:(id:string)=>Promise<void>;deleteUser:(id:string)=>Promise<void>;can:(permission:Permission)=>boolean;requirePermission:(permission:Permission)=>void;refreshUsers:()=>void;remote:boolean};
const AuthContext=createContext<AuthValue|null>(null);

function readUsers(){try{return JSON.parse(localStorage.getItem(USERS_KEY)||"[]") as ToyQMSUser[]}catch{return []}}
function writeUsers(users:ToyQMSUser[]){localStorage.setItem(USERS_KEY,JSON.stringify(users))}

export function AuthProvider({children}:{children:React.ReactNode}){
  // Accounts and data always live in the backend database (no local mode).
  const remote=true;
  const [loading,setLoading]=useState(true),[users,setUsers]=useState<PublicUser[]>([]),[user,setUser]=useState<PublicUser|null>(null);
  const refreshUsers=useCallback(()=>{
    if(remote){apiFetch<PublicUser[]>("/users").then(setUsers).catch(()=>setUsers([]));return}
    setUsers(readUsers().map(publicUser));
  },[remote]);
  useEffect(()=>{void(async()=>{
    if(remote){
      await ensureReachableBackend();
      try{
        if(getRemoteToken()){const me=await apiFetch<{user:PublicUser}>("/auth/me");setUser(me.user)}
        try{setUsers(await apiFetch<PublicUser[]>("/users"))}catch{setUsers([])}
      }catch{setUser(null)}
      setLoading(false);return;
    }
    let stored=readUsers();if(!stored.length){const now=new Date().toISOString();const credentials=await passwordFields(DEFAULT_PASSWORD);stored=[{id:randomId(),name:"JC",responsibility:"质量总监",loginName:"JC",category:"all",permissions:[...defaultPermissions.all],enabled:true,mustChangePassword:true,...credentials,createdAt:now,updatedAt:now,isPrimary:true}];writeUsers(stored)}setUsers(stored.map(publicUser));const sessionId=localStorage.getItem(SESSION_KEY);const active=stored.find(item=>item.id===sessionId&&item.enabled);setUser(active?publicUser(active):null);if(!active)localStorage.removeItem(SESSION_KEY);setLoading(false);
  })()},[remote]);
  const commit=useCallback((next:ToyQMSUser[])=>{writeUsers(next);setUsers(next.map(publicUser));if(user){const current=next.find(item=>item.id===user.id&&item.enabled);setUser(current?publicUser(current):null);if(!current)localStorage.removeItem(SESSION_KEY)}},[user]);
  const login=useCallback(async(loginName:string,password:string)=>{
    if(remote){
      const result=await apiFetch<{token:string;user:PublicUser}>("/auth/login",{method:"POST",body:{loginName,password}});
      setRemoteToken(result.token);setUser(result.user);refreshUsers();return result.user;
    }
    const stored=readUsers();const match=stored.find(item=>normalizeLoginName(item.loginName)===normalizeLoginName(loginName));if(!match||!match.enabled||await hashPassword(password,match.passwordSalt)!==match.passwordHash)throw new Error("登录名称或密码不正确，或账户已被停用。");localStorage.setItem(SESSION_KEY,match.id);const safe=publicUser(match);setUser(safe);return safe;
  },[remote,refreshUsers]);
  const logout=useCallback(()=>{
    if(remote){void apiFetch("/auth/logout",{method:"POST",body:{}}).catch(()=>undefined);setRemoteToken(null);setUser(null);return}
    localStorage.removeItem(SESSION_KEY);setUser(null);
  },[remote]);
  const changeOwnPassword=useCallback(async(currentPassword:string,newPassword:string)=>{
    if(!user)throw new Error("请先登录。");if(newPassword.length<8)throw new Error("新密码至少需要 8 个字符。");
    if(remote){await apiFetch("/auth/change-password",{method:"POST",body:{currentPassword,newPassword}});setUser({...user,mustChangePassword:false});return}
    const stored=readUsers();const current=stored.find(item=>item.id===user.id);if(!current||await hashPassword(currentPassword,current.passwordSalt)!==current.passwordHash)throw new Error("当前密码不正确。");const credentials=await passwordFields(newPassword);const next=stored.map(item=>item.id===user.id?{...item,...credentials,mustChangePassword:false,updatedAt:new Date().toISOString()}:item);commit(next);
  },[remote,user,commit]);
  const requirePermission=useCallback((permission:Permission)=>{if(!hasPermission(user,permission))throw new Error("当前账户没有执行此操作的权限。")},[user]);
  const createUser=useCallback(async(input:CreateUserInput)=>{
    requirePermission("manage_users");
    if(remote){await apiFetch("/users",{method:"POST",body:input});refreshUsers();return}
    const stored=readUsers();const loginName=input.loginName.trim();if(!input.name.trim()||!input.responsibility.trim()||!loginName)throw new Error("请填写名称、职责和登录名称。");if(stored.some(item=>normalizeLoginName(item.loginName)===normalizeLoginName(loginName)))throw new Error("登录名称已存在。");const now=new Date().toISOString();const credentials=await passwordFields(DEFAULT_PASSWORD);stored.push({id:randomId(),name:input.name.trim(),responsibility:input.responsibility.trim(),loginName,category:input.category,permissions:[...(input.permissions??defaultPermissions[input.category])],enabled:true,mustChangePassword:true,...credentials,createdAt:now,updatedAt:now,isPrimary:false});commit(stored);
  },[remote,requirePermission,commit,refreshUsers]);
  const updateUser=useCallback(async(id:string,input:UpdateUserInput)=>{
    requirePermission("manage_users");
    if(remote){const updated=await apiFetch<PublicUser>(`/users/${id}`,{method:"PATCH",body:input});if(user&&updated.id===user.id)setUser(updated);refreshUsers();return}
    const stored=readUsers();const current=stored.find(item=>item.id===id);if(!current)throw new Error("用户不存在。");const loginName=input.loginName?.trim()??current.loginName;if(stored.some(item=>item.id!==id&&normalizeLoginName(item.loginName)===normalizeLoginName(loginName)))throw new Error("登录名称已存在。");const category=input.category??current.category;const permissions=input.permissions??(input.category&&input.category!==current.category?defaultPermissions[category]:current.permissions);const enabled=input.enabled??current.enabled;const candidate={...current,...input,loginName,category,permissions:[...permissions],enabled,updatedAt:new Date().toISOString()};const next=stored.map(item=>item.id===id?candidate:item);if(!next.some(item=>item.enabled&&item.permissions.length===defaultPermissions.all.length&&defaultPermissions.all.every(permission=>item.permissions.includes(permission))))throw new Error("系统必须保留至少一个启用中的所有权限账户。");if(id===user?.id&&!enabled)throw new Error("不能停用当前登录账户。");commit(next);
  },[remote,requirePermission,commit,user,refreshUsers]);
  const resetPassword=useCallback(async(id:string)=>{
    requirePermission("manage_users");
    if(remote){await apiFetch(`/users/${id}/reset-password`,{method:"POST",body:{}});refreshUsers();return}
    const stored=readUsers();if(!stored.some(item=>item.id===id))throw new Error("用户不存在。");const credentials=await passwordFields(DEFAULT_PASSWORD);commit(stored.map(item=>item.id===id?{...item,...credentials,mustChangePassword:true,updatedAt:new Date().toISOString()}:item));
  },[remote,requirePermission,commit,refreshUsers]);
  const deleteUser=useCallback(async(id:string)=>{
    requirePermission("manage_users");if(id===user?.id)throw new Error("不能删除当前登录账户。");
    if(remote){await apiFetch(`/users/${id}`,{method:"DELETE"});refreshUsers();return}
    const stored=readUsers();const current=stored.find(item=>item.id===id);if(!current)throw new Error("用户不存在。");const next=stored.filter(item=>item.id!==id);if(!next.some(item=>item.enabled&&defaultPermissions.all.every(permission=>item.permissions.includes(permission))))throw new Error("系统必须保留至少一个启用中的所有权限账户。");commit(next);
  },[remote,requirePermission,commit,user,refreshUsers]);
  const value=useMemo<AuthValue>(()=>({loading,user,users,login,logout,changeOwnPassword,createUser,updateUser,resetPassword,deleteUser,can:permission=>hasPermission(user,permission),requirePermission,refreshUsers,remote}),[loading,user,users,login,logout,changeOwnPassword,createUser,updateUser,resetPassword,deleteUser,requirePermission,refreshUsers,remote]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error("useAuth must be used inside AuthProvider");return value}

export function AuthGate({children}:{children:React.ReactNode}){
  const {loading,user}=useAuth();const rawPath=usePathname();const router=useRouter();
  const path=rawPath!=="/"?rawPath.replace(/\/+$/,""):rawPath;
  useEffect(()=>{if(loading)return;if(!user&&path!=="/login")router.replace("/login");else if(user&&path==="/login"&&!user.mustChangePassword)router.replace("/dashboard")},[loading,user,path,router]);
  if(loading)return <div className="grid min-h-screen place-items-center bg-neutral-100 text-sm text-neutral-500">正在载入 ToyQMS…</div>;
  if(path==="/login")return <>{children}</>;
  if(!user)return <div className="min-h-screen bg-neutral-100"/>;
  const normalized=path;const permission=routePermission[normalized];
  if(permission&&!hasPermission(user,permission))return <div className="grid min-h-screen place-items-center bg-neutral-100 p-6"><div className="max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold">没有访问权限</h1><p className="mt-2 text-sm text-neutral-500">当前账户不能打开此页面，请联系拥有所有权限的账户调整权限。</p><button onClick={()=>router.replace("/dashboard")} className="btn-accent mt-5">返回仪表盘</button></div></div>;
  return <>{children}</>
}
