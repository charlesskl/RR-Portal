"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Anchor, ArrowLeft, CalendarDays, Check, ChevronRight, ClipboardCheck, Container,
  Database, FileSpreadsheet, FileUp, Inbox, LayoutDashboard, ListChecks,
  Download, Map as MappingIcon, Plus, RefreshCw, Search, Settings, Ship, Trash2, Upload, Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const apiPath = (path: string) => `${basePath}${path}`;

const navigation: Array<{href:string;label:string;icon:typeof LayoutDashboard;roles:UserRole[]}> = [
  { href: "/", label: "首页", icon: LayoutDashboard, roles:["admin","shipping","warehouse"] },
  { href: "/imports", label: "信息导入", icon: FileUp, roles:["admin","shipping"] },
  { href: "/shipments", label: "走柜任务", icon: Container, roles:["admin","shipping","warehouse"] },
  { href: "/inventory", label: "库存管理", icon: Database, roles:["admin","warehouse"] },
  { href: "/users", label: "用户管理", icon: Users, roles:["admin"] },
  { href: "/settings", label: "系统设置", icon: Settings, roles:["admin"] },
];

const titles: Record<string, string> = {
  imports: "信息导入", shipments: "走柜任务", inventory: "库存管理",
  users:"用户管理", settings: "系统设置",
};

type ParsedFields = Record<string, string>;
type WarehouseGroup = { warehouse: string; references: string[]; items: Array<Record<string, unknown>>; source_files: string[]; container_type?:string; loading_factory?:string };
type ParsedEmail = {
  import_item_id: number; filename: string; status: string; error?: string;
  duplicate_of_item_id?: number; message?: { subject?: string; sender?: string; received_at?: string };
  fields?: ParsedFields; attachments?: Array<{ filename: string; size: number }>;
  attachment_results?: Array<{ filename: string; kind: string; item_count: number }>;
  items?: Array<Record<string, unknown>>; warehouse_groups?: WarehouseGroup[]; warnings?: string[];
};
type EmailBatch = { total: number; parsed: number; failed: number; parser_version?:string; items: ParsedEmail[] };
type SheetItem = { import_item_id: number; filename: string; status: string; error?: string; kind?: string; sheet?: string; rows?: Array<Record<string, unknown>>; warnings?: string[] };
type SheetBatch = { import_batch_id: number; total: number; parsed: number; failed: number; items: SheetItem[] };
type InspectionMappingRow = { customer: string; productCode: string; productName: string; owner: string; productionPlace: string; note: string };
type InspectionMappingGroup = { name: string; inspectionSource: string; description?: string; excluded?: boolean; rows: InspectionMappingRow[] };
type StoredInspectionMapping = InspectionMappingRow & { id: number; groupName: string; inspectionSource: string; isExcluded: boolean };
type ProductInfo = {id:number;legacyId:number;customer:string;productCode:string;productName:string;quantityPerBox:number|null;toyCategory:string;factoryRemark:string;grossWeightPerBox:number|null;netWeightPerBox:number|null;source:string};
type ShipmentItem = Record<string, any>;
type ShipmentTaskData = {
  id:number; customer:string; emailSubject?:string; soNumber?:string; containerType:string; plannedShipDate?:string;
  cutoffDate:string; siDeadline:string; port:string; destinationCountry:string; transportReference:string; specialRequirements:string;
  status:"PendingReview"|"PendingShipment"|"Completed"|"Cancelled"; completedDate?:string;
  warehouseGroups:WarehouseGroup[]; items:ShipmentItem[]; createdAt?:string; updatedAt?:string;
};
type LocalInventoryScan = {folder:string;exists:boolean;scanned_at?:string;total_rows:number;successful_files?:number;error?:string;files:Array<{filename:string;modified_at:string;size:number;status:string;kind:string;sheets:string[];row_count:number;warnings?:string[];error?:string}>};
type UserRole = "admin" | "shipping" | "warehouse";
type CurrentUser = {id:number;username:string;displayName:string;role:UserRole;isActive:boolean;createdAt:string;updatedAt:string;lastLoginAt?:string};
type LocalDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(options?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  values(): AsyncIterableIterator<FileSystemFileHandle>;
};

const localDirectoryDatabase = "voyageplex-local-directories";
const localDirectoryStore = "handles";
const inventoryExtensions = [".xls", ".xlsx", ".xlsm", ".csv"];

function directoryKey(role: UserRole) { return `inventory-${role}`; }

function dateControlValue(value: string | undefined, includeTime = false) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (iso) return includeTime ? `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4] || "00"}:${iso[5] || "00"}` : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const short = raw.match(/(\d{1,2})[\/月.-](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!short) return "";
  const year = new Date().getFullYear();
  const date = `${year}-${short[1].padStart(2,"0")}-${short[2].padStart(2,"0")}`;
  return includeTime ? `${date}T${(short[3] || "00").padStart(2,"0")}:${short[4] || "00"}` : date;
}

async function openLocalDirectoryDatabase() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(localDirectoryDatabase, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(localDirectoryStore);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalDirectory(role: UserRole, handle: LocalDirectoryHandle) {
  const database = await openLocalDirectoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(localDirectoryStore, "readwrite");
    transaction.objectStore(localDirectoryStore).put(handle, directoryKey(role));
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function loadLocalDirectory(role: UserRole) {
  const database = await openLocalDirectoryDatabase();
  const handle = await new Promise<LocalDirectoryHandle | undefined>((resolve, reject) => {
    const request = database.transaction(localDirectoryStore, "readonly").objectStore(localDirectoryStore).get(directoryKey(role));
    request.onsuccess = () => resolve(request.result as LocalDirectoryHandle | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close(); return handle;
}

async function loadConfiguredDirectory(role: UserRole) {
  const direct = await loadLocalDirectory(role);
  if (direct || role !== "admin") return direct;
  return await loadLocalDirectory("shipping") || await loadLocalDirectory("warehouse");
}

async function authorizedInventoryFiles(role: UserRole) {
  const handle = await loadConfiguredDirectory(role);
  if (!handle) throw new Error("请先到系统设置选择本地库存文件夹");
  let permission = await handle.queryPermission({ mode:"readwrite" });
  if (permission !== "granted") permission = await handle.requestPermission({ mode:"readwrite" });
  if (permission !== "granted") throw new Error("未获得本地库存文件夹读写权限，请重新授权");
  const files: File[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || entry.name.startsWith("~$") || entry.name.includes("回写前备份-") || entry.name.startsWith("库存扣减") || !inventoryExtensions.some(extension => entry.name.toLowerCase().endsWith(extension))) continue;
    files.push(await entry.getFile());
  }
  if (!files.length) throw new Error("所选文件夹中没有可读取的库存表");
  return { handle, files };
}

const shipmentStatus: Record<ShipmentTaskData["status"], string> = {
  PendingReview:"待复核", PendingShipment:"待走货", Completed:"走货完成", Cancelled:"已取消",
};

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { return { error: response.ok ? "服务返回格式异常" : `后台服务异常（${response.status}）` }; }
}

function decodeBase64(value:string) {
  const binary=window.atob(value); const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

function shortInventorySource(value:unknown) {
  return String(value||"").split("；").map(source=>{
    const parts=source.split("/").map(part=>part.trim());
    if(parts.length<3)return source.trim();
    const filename=parts[0].replace(/\.(xlsx|xlsm|xls)$/i,"").replace(/[（(]\d+[）)]$/g,"")
      .replace(/^20\d{2}[\u5e74-]?/,"").replace(/(\d{1,2})月份/g,"$1月").replace("车间库存表","库存表");
    return `${filename}/${parts[1]}/${parts.slice(2).join("/").replace(/^第/,"")}`;
  }).join("；");
}

function normalizeInventorySourceDisplay(task:ShipmentTaskData) {
  return {...task,items:task.items.map(item=>{
    const fullSource=String(item.inventory_source_full||item.inventory_source||"");
    return fullSource?{...item,inventory_source:shortInventorySource(fullSource),inventory_source_full:fullSource}:item;
  })};
}

function productNameSpec(item:Record<string,unknown>){
  const name=String(item.product_name||"").trim();const spec=String(item.spec??"").trim();
  return spec?`${name}${name?" ":""}${spec}个/箱`:name;
}

function splitProductNameSpec(value:string){
  const match=value.trim().match(/^(.*?)[,，;；\s]*(\d+(?:\.\d+)?)\s*个\s*\/?\s*箱\s*$/);
  return match?{product_name:match[1].trim(),spec:match[2]}:{product_name:value,spec:""};
}

function fullSpecification(value:unknown){
  const raw=String(value??"").trim();
  if(!raw)return "";
  return /^\d+(?:\.\d+)?$/.test(raw)?`${raw}个/箱`:raw;
}

function specificationValue(value:string){
  const match=value.trim().match(/^(\d+(?:\.\d+)?)\s*个\s*\/?\s*箱$/);
  return match?match[1]:value;
}

const compactNumberFields=new Set(["quantity","pieces","gross_weight","net_weight","volume","order_total_pieces","gross_weight_per_box","net_weight_per_box","pallet_count"]);

function itemDisplayValue(key:string,value:unknown){
  if(value===null||value===undefined||value==="")return "";
  if(!compactNumberFields.has(key))return String(value);
  const numeric=Number(value);
  if(!Number.isFinite(numeric))return String(value);
  return String(Math.round((numeric+Number.EPSILON)*1000)/1000);
}

async function applyInventoryWritebackFiles(handle:LocalDirectoryHandle, outputs:Array<Record<string,unknown>>) {
  const prepared=[];
  for(const output of outputs){
    const backupHandle=await handle.getFileHandle(String(output.backup_filename),{create:true});
    const targetHandle=await handle.getFileHandle(String(output.filename),{create:false});
    prepared.push({backupHandle,targetHandle,original:decodeBase64(String(output.backup_base64)),updated:decodeBase64(String(output.content_base64))});
  }
  for(const item of prepared){const writer=await item.backupHandle.createWritable();await writer.write(item.original);await writer.close();}
  const attempted:typeof prepared=[];
  try{
    for(const item of prepared){attempted.push(item);const writer=await item.targetHandle.createWritable();await writer.write(item.updated);await writer.close();}
  }catch(reason){
    for(const item of attempted.reverse()){try{const writer=await item.targetHandle.createWritable();await writer.write(item.original);await writer.close();}catch{/* 原表备份仍保留在同目录，便于人工恢复 */}}
    throw reason;
  }
}

const inspectionMappingGroups: InspectionMappingGroup[] = [
  { name: "兴信B车间", inspectionSource: "兴信验货总结表", rows: [
    { customer:"ZURU", productCode:"77198", productName:"迷你小手袋", owner:"龙丽娟", productionPlace:"兴信B车间", note:"" },
    { customer:"ZURU", productCode:"9284", productName:"摇头小狗", owner:"龙丽娟", productionPlace:"兴信B车间", note:"" },
    { customer:"ZURU", productCode:"77366", productName:"迷你小手袋", owner:"龙丽娟", productionPlace:"兴信B车间", note:"" },
    { customer:"Tigerhead", productCode:"BS062", productName:"手提包+毛绒公仔", owner:"龙丽娟", productionPlace:"兴信B车间", note:"" },
    { customer:"Tigerhead", productCode:"BS063", productName:"手提包+毛绒公仔", owner:"龙丽娟", productionPlace:"兴信B车间", note:"" },
    { customer:"TOMY", productCode:"47639", productName:"卡车", owner:"龙丽娟", productionPlace:"兴信B车间", note:"" },
  ]},
  { name: "兴信A车间 · 石玉珍", inspectionSource: "兴信验货总结表", rows: [
    { customer:"ZURU", productCode:"77555GQ1-S002", productName:"迷你房子", owner:"石玉珍", productionPlace:"兴信A车间", note:"" },
    { customer:"ZURU", productCode:"77584-S001", productName:"迷你房子*2", owner:"石玉珍", productionPlace:"兴信A车间", note:"" },
    { customer:"ZURU", productCode:"25251-S001", productName:"鸭子", owner:"石玉珍", productionPlace:"兴信A车间", note:"" },
    { customer:"TOMY", productCode:"46644B", productName:"发光车", owner:"石玉珍", productionPlace:"兴信A车间", note:"" },
  ]},
  { name: "兴信A车间 · 李诗妍", inspectionSource: "兴信验货总结表", rows: [
    { customer:"ZURU", productCode:"9281", productName:"", owner:"李诗妍", productionPlace:"兴信B车间", note:"" },
    { customer:"ZURU", productCode:"71101", productName:"", owner:"李诗妍", productionPlace:"兴信A车间", note:"" },
    { customer:"ZURU", productCode:"15701", productName:"", owner:"李诗妍", productionPlace:"兴信A车间", note:"" },
    { customer:"ZURU", productCode:"92125", productName:"", owner:"李诗妍", productionPlace:"兴信B车间", note:"" },
  ]},
  { name: "华嘉", inspectionSource: "兴信验货总结表", description:"华嘉货号统一在兴信验货总结表中查询", rows: [
    { customer:"ZURU", productCode:"15728", productName:"", owner:"华嘉", productionPlace:"华嘉", note:"兴信表" },
    { customer:"ZURU", productCode:"157140", productName:"", owner:"华嘉", productionPlace:"华嘉", note:"兴信表" },
    { customer:"ZURU", productCode:"15757", productName:"", owner:"华嘉", productionPlace:"华嘉", note:"兴信表" },
    { customer:"ZURU", productCode:"157149", productName:"", owner:"华嘉", productionPlace:"华嘉", note:"兴信表" },
  ]},
  { name: "湖南 · 钟雅娴", inspectionSource: "湖南验货总结表", rows: [
    { customer:"ZURU", productCode:"7127", productName:"新颜色恐龙", owner:"钟雅娴", productionPlace:"新邵", note:"" },
    { customer:"ZURU", productCode:"7132", productName:"红色霸王龙", owner:"钟雅娴", productionPlace:"湖南", note:"" },
    { customer:"ZURU", productCode:"71137", productName:"眼镜蛇", owner:"钟雅娴", productionPlace:"邵阳厂区", note:"" },
    { customer:"ZURU", productCode:"15726", productName:"富格乐拼接系列", owner:"钟雅娴", productionPlace:"湖南", note:"" },
  ]},
  { name: "湖南 · 吕宇祥", inspectionSource: "湖南验货总结表", rows: [
    { customer:"ZURU", productCode:"77485", productName:"3代迷你小手袋", owner:"吕宇祥", productionPlace:"湖南", note:"" },
    { customer:"ZURU", productCode:"77794", productName:"", owner:"吕宇祥", productionPlace:"湖南", note:"" },
    { customer:"Tigerhead", productCode:"BS065", productName:"手提包+狗公仔", owner:"吕宇祥", productionPlace:"湖南", note:"" },
    { customer:"TOMY", productCode:"T72465EN6", productName:"贪婪的奶奶", owner:"吕宇祥", productionPlace:"湖南", note:"" },
  ]},
  { name: "湖南 · 杨海彬", inspectionSource: "湖南验货总结表", rows: [
    { customer:"ZURU", productCode:"92119", productName:"冰雪蛋", owner:"杨海彬", productionPlace:"湖南", note:"" },
    { customer:"ZURU", productCode:"25282", productName:"鲨鱼", owner:"杨海彬", productionPlace:"湖南", note:"" },
    { customer:"ZURU", productCode:"15727", productName:"毛毛系列", owner:"杨海彬", productionPlace:"湖南", note:"" },
    { customer:"ZURU", productCode:"92105", productName:"", owner:"杨海彬", productionPlace:"湖南", note:"" },
  ]},
  { name: "华登", inspectionSource: "华登验货总结表", rows: [
    { customer:"ZURU", productCode:"92150", productName:"", owner:"王远露", productionPlace:"东莞华登", note:"" },
    { customer:"ZURU", productCode:"92107", productName:"", owner:"", productionPlace:"湖南华登", note:"" },
    { customer:"ZURU", productCode:"15706", productName:"", owner:"王远露", productionPlace:"东莞华登", note:"" },
    { customer:"ZURU", productCode:"92108", productName:"", owner:"王远露", productionPlace:"东莞华登", note:"" },
  ]},
  { name: "河源", inspectionSource: "不参与验货检查", description:"河源自行做柜，系统保留映射但不读取验货结果", excluded:true, rows: [
    { customer:"ZURU", productCode:"15746", productName:"飞天小女警系列", owner:"钟雅娴", productionPlace:"河源", note:"自行做柜" },
    { customer:"ZURU", productCode:"15751", productName:"食物系列", owner:"石玉珍", productionPlace:"河源", note:"自行做柜" },
    { customer:"ZURU", productCode:"15760", productName:"六代钥匙扣系列", owner:"华登", productionPlace:"河源", note:"自行做柜" },
  ]},
];

export function AppShell({ route }: { route: string }) {
  const [user,setUser] = useState<CurrentUser|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [authError,setAuthError] = useState("");
  const [setupRequired,setSetupRequired] = useState(false);
  async function loadUser(){setAuthLoading(true);setAuthError("");try{const response=await fetch(apiPath("/api/auth/me"),{cache:"no-store"});if(response.ok){setUser(await response.json());setSetupRequired(false);}else if(response.status===401){setUser(null);const setup=await fetch(apiPath("/api/auth/setup-status"),{cache:"no-store"});if(!setup.ok)throw new Error("无法检查系统初始化状态");setSetupRequired(Boolean((await setup.json()).required));}else{throw new Error("后台暂时无法检查登录状态");}}catch(reason){setAuthError(reason instanceof Error?reason.message:"后台连接失败");}finally{setAuthLoading(false);}}
  useEffect(()=>{void loadUser();},[]);
  async function logout(){await fetch(apiPath("/api/auth/logout"),{method:"POST"});setUser(null);window.location.href=basePath+"/";}
  if(authLoading)return <div className="auth-screen"><div className="auth-card"><span className="brand-mark"><Anchor size={19}/></span><h1>VoyagePlex</h1><p>正在检查登录状态…</p></div></div>;
  if(authError)return <div className="auth-screen"><div className="auth-card"><span className="brand-mark"><Anchor size={19}/></span><h1>暂时无法连接后台</h1><p>{authError}，请稍后重试。</p><button className="primary-button" onClick={()=>void loadUser()}>重新连接</button></div></div>;
  if(!user)return <AuthScreen setupRequired={setupRequired} onAuthenticated={value=>setUser(value)} />;
  const role=user.role;
  const page = route.split("/")[0];
  const currentPath = page ? `/${page}` : "/";
  const pageAllowed=navigation.find(item=>item.href===currentPath)?.roles.includes(role)??false;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Anchor size={19} /></span>
          <span><strong>VoyagePlex</strong><small>船务协同系统</small></span>
        </div>
        <nav aria-label="主要导航">
          {navigation.filter(item=>item.roles.includes(role)).map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={currentPath === item.href ? "nav-item active" : "nav-item"}><Icon size={18} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-foot"><span className="connection-dot" />共享盘已连接<small>只读模式</small></div>
      </aside>
      <main>
        <header className="topbar">
          <strong className="topbar-title">{titles[page] ?? "首页"}</strong>
          <div className="avatar">{role==="admin"?"管理":role==="warehouse"?"仓务":"船务"}</div><span className="user-name"><b>{user.displayName}</b><small>{roleLabel(role)}</small></span><button className="logout-button" onClick={()=>void logout()}>退出</button>
        </header>
        {!pageAllowed?<AccessDenied/>:page === "imports" ? <ImportCenter /> : page === "shipments" ? <ShipmentCenter route={route} role={role} /> : page === "inventory" ? <InventoryCenter route={route} role={role} /> : page === "users" ? <UserManagement currentUser={user}/> : page === "settings" ? <SettingsCenter role={role} /> : <Dashboard />}
      </main>
    </div>
  );
}

function roleLabel(role:UserRole){return role==="admin"?"管理员":role==="warehouse"?"仓库文员":"船务员";}

function AuthScreen({setupRequired,onAuthenticated}:{setupRequired:boolean;onAuthenticated:(user:CurrentUser)=>void}){
  const [username,setUsername]=useState("");const [displayName,setDisplayName]=useState("");const [password,setPassword]=useState("");const [error,setError]=useState("");const [saving,setSaving]=useState(false);
  async function submit(event:React.FormEvent){event.preventDefault();setSaving(true);setError("");try{if(setupRequired){const setup=await fetch(apiPath("/api/auth/setup"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,displayName,password})});const result=await readJsonResponse(setup);if(!setup.ok)throw new Error(result.error||"初始化失败");}const response=await fetch(apiPath("/api/auth/login"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"登录失败");onAuthenticated(result);}catch(reason){setError(reason instanceof Error?reason.message:"操作失败");}finally{setSaving(false);}}
  return <div className="auth-screen"><form className="auth-card" onSubmit={submit}><span className="brand-mark"><Anchor size={19}/></span><h1>{setupRequired?"初始化管理员":"登录 VoyagePlex"}</h1><p>{setupRequired?"首次使用，请创建系统管理员账号。":"使用系统账号继续。"}</p><label><span>账号</span><input autoFocus autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)} required minLength={3}/></label>{setupRequired&&<label><span>姓名</span><input value={displayName} onChange={event=>setDisplayName(event.target.value)} required maxLength={50}/></label>}<label><span>密码</span><input type="password" autoComplete={setupRequired?"new-password":"current-password"} value={password} onChange={event=>setPassword(event.target.value)} required minLength={8}/></label>{error&&<div className="form-error">{error}</div>}<button className="primary-button" disabled={saving}>{saving?"处理中…":setupRequired?"创建并登录":"登录"}</button></form></div>;
}

function AccessDenied(){return <div className="content"><section className="empty-state"><div className="empty-icon"><Users/></div><h2>无权访问</h2><p>当前账号没有此模块的使用权限，请联系管理员调整角色。</p></section></div>;}

function Dashboard() {
  const [tasks,setTasks]=useState<ShipmentTaskData[]>([]);
  useEffect(()=>{void(async()=>{try{const response=await fetch(apiPath("/api/shipments"),{cache:"no-store"});if(response.ok)setTasks(await response.json());}catch{/* 首页保留空状态，避免影响其他操作 */}})();},[]);
  const active=tasks.filter(task=>task.status!=="Cancelled");
  const counts={changes:active.filter(hasTaskChange).length,review:active.filter(task=>task.status==="PendingReview").length,shipment:active.filter(task=>task.status==="PendingShipment").length,completed:active.filter(task=>task.status==="Completed").length};
  const anomalies=active.flatMap(task=>taskAnomalies(task).map(anomaly=>({task,...anomaly}))).sort((left,right)=>right.priority-left.priority||left.deadline.localeCompare(right.deadline));
  return <div className="content">
    <div className="page-heading"><div><p className="eyebrow">2026年8月 · 船务工作台</p><h1>今天需要处理的出货任务</h1><p>先核对资料，再生成走柜表。</p></div><Link href="/shipments" className="primary-button"><Container size={17} />查看走柜安排</Link></div>
    <section className="stats" aria-label="任务统计">
      <article className="gradient-violet"><span>变更待处理</span><strong>{counts.changes}</strong><small>任务资料发生变更</small><RefreshCw className="stat-icon" /></article>
      <article className="gradient-orange"><span>待复核</span><strong>{counts.review}</strong><small>等待船务复核</small><ClipboardCheck className="stat-icon" /></article>
      <article className="gradient-green"><span>待走货</span><strong>{counts.shipment}</strong><small>等待仓务出货</small><Container className="stat-icon" /></article>
      <article className="gradient-pink"><span>已完成</span><strong>{counts.completed}</strong><small>走货任务已完成</small><Ship className="stat-icon" /></article>
    </section>
    <section className="panel tasks-panel"><PanelTitle title="异常走柜任务" subtitle="按紧急程度排列" link="/shipments" />
      <div className="task-row anomaly table-head"><span>客户 / SO</span><span>计划出货</span><span>异常原因</span><span>当前状态</span></div>
      {anomalies.map(({task,reason},index)=><Link href={`/shipments/${task.id}`} className="task-row anomaly" key={`${task.id}-${reason}-${index}`}><span><strong>{task.customer}</strong><small>{task.soNumber||"SO待确认"}</small></span><span>{task.plannedShipDate||"待安排"}</span><span><b className="status danger">{reason}</b></span><span>{shipmentStatus[task.status]}</span></Link>)}
      {!anomalies.length&&<div className="shipment-empty">暂无异常任务</div>}
    </section>
  </div>;
}

const anomalyPriority={scheduleDelay:400,inspectionFailed:300,inventoryShortage:200,changed:100} as const;
function hasTaskChange(task:ShipmentTaskData){return Boolean(task.updatedAt&&task.createdAt&&new Date(task.updatedAt).getTime()-new Date(task.createdAt).getTime()>1000);}
function taskTimeDisplay(task:ShipmentTaskData){
  const modified=hasTaskChange(task);const value=modified?task.updatedAt:task.createdAt;
  if(!value)return {label:modified?"修改":"创建",value:"—"};
  const date=new Date(value);if(Number.isNaN(date.getTime()))return {label:modified?"修改":"创建",value:String(value)};
  const pad=(part:number)=>String(part).padStart(2,"0");
  return {label:modified?"修改":"创建",value:`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`};
}
function taskAnomalies(task:ShipmentTaskData){
  if(task.status==="Completed")return [];
  const today=new Date().toLocaleDateString("sv-SE");const deadline=task.plannedShipDate||"9999-12-31";const result:Array<{reason:string;priority:number;deadline:string}>=[];
  if(task.plannedShipDate&&task.plannedShipDate<today)result.push({reason:"船期延误",priority:anomalyPriority.scheduleDelay,deadline});
  if(task.items.some(item=>/不通过|未通过|fail|reject/i.test(String(item.inspection_result||item.qc_result||""))))result.push({reason:"验货不过",priority:anomalyPriority.inspectionFailed,deadline});
  if(task.items.some(item=>item.inventory_quantity!==undefined&&item.inventory_quantity!==""&&Number(item.inventory_quantity)<Number(item.quantity)))result.push({reason:"货品数量不够",priority:anomalyPriority.inventoryShortage,deadline});
  if(hasTaskChange(task))result.push({reason:"变更时间",priority:anomalyPriority.changed,deadline});
  return result;
}

function ImportCenter() {
  const [tab, setTab] = useState<"email" | "sheet">("email");
  const [emailFiles, setEmailFiles] = useState<File[]>([]);
  const [emailBatch, setEmailBatch] = useState<EmailBatch | null>(null);
  const [sheetFiles, setSheetFiles] = useState<File[]>([]);
  const [sheetBatch, setSheetBatch] = useState<SheetBatch | null>(null);
  const [selectedEmailIndex, setSelectedEmailIndex] = useState(0);
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [createdTaskIds, setCreatedTaskIds] = useState<number[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const email = tab === "email";
  const selectedEmail = emailBatch?.items?.[selectedEmailIndex];
  const selectedSheet = sheetBatch?.items?.[selectedEmailIndex];
  const parsedFields = selectedEmail?.fields;
  const fields = email
    ? [["SO号",parsedFields?.so_number || "待识别"],["柜型",parsedFields?.container_type || "待识别"],["计划走货日期",parsedFields?.ship_date || ""],["SI截止",parsedFields?.si_deadline || "待识别"],["截数期",parsedFields?.cutoff_date || "待识别"],["装货港",parsedFields?.port || "待识别"],["收货地",parsedFields?.destination_country || "待确认"],["特殊要求",parsedFields?.special_requirements || "待人工确认"]]
    : [["资料类型","客户排期表"],["工作表","总排期"],["识别订单","26条"],["新增记录","3条"],["更新记录","18条"],["异常记录","5条"]];

  async function parseSelectedEmails() {
    if (!emailFiles.length) { fileInput.current?.click(); return; }
    const maxFileBytes = 25 * 1024 * 1024;
    const maxBatchBytes = 200 * 1024 * 1024;
    if (emailFiles.length > 50) { setEmailError("单批最多上传 50 封邮件"); return; }
    if (emailFiles.some(file => file.size <= 0 || file.size > maxFileBytes)) { setEmailError("每封邮件必须大于 0 且不超过 25MB"); return; }
    if (emailFiles.reduce((total, file) => total + file.size, 0) > maxBatchBytes) { setEmailError("所选邮件总大小超过 200MB，请分批上传"); return; }
    setEmailLoading(true); setEmailError(""); setEmailBatch(null); setSelectedEmailIndex(0); setConfirmed(false); setCreatedTaskIds([]);
    const data = new FormData();
    emailFiles.forEach(file => data.append("files", file));
    try {
      const response = await fetch(apiPath("/api/imports/email"), { method: "POST", body: data });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || "解析服务返回错误");
      setEmailBatch(result as EmailBatch);
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "邮件解析失败");
    } finally { setEmailLoading(false); }
  }

  async function parseSelectedSheets() {
    if (!sheetFiles.length) { fileInput.current?.click(); return; }
    setEmailLoading(true); setEmailError(""); setSheetBatch(null); setSelectedEmailIndex(0); setConfirmed(false); setCreatedTaskIds([]);
    const data = new FormData();
    sheetFiles.forEach(file => data.append("files", file));
    try {
      const response = await fetch(apiPath("/api/imports/spreadsheet"), { method: "POST", body: data });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || "表格解析服务返回错误");
      setSheetBatch(result as SheetBatch);
    } catch (error) { setEmailError(error instanceof Error ? error.message : "表格解析失败"); }
    finally { setEmailLoading(false); }
  }

  function updateField(key: string, value: string) {
    setEmailBatch(current => {
      if (!current) return current;
      const items = current.items.map((item, index) => index === selectedEmailIndex
        ? { ...item, fields: { ...(item.fields || {}), [key]: value } }
        : item);
      return { ...current, items };
    });
  }

  function updateWarehouse(groupIndex: number, value: string) {
    setEmailBatch(current => {
      if (!current) return current;
      const items = current.items.map((item, index) => {
        if (index !== selectedEmailIndex) return item;
        const groups = (item.warehouse_groups || []).map((group, i) => i === groupIndex ? { ...group, warehouse: value } : group);
        return { ...item, warehouse_groups: groups };
      });
      return { ...current, items };
    });
  }

  function updateEmailItem(itemIndex: number, key: string, value: string) {
    setEmailBatch(current => {
      if (!current) return current;
      const items = current.items.map((emailItem, emailIndex) => {
        if (emailIndex !== selectedEmailIndex) return emailItem;
        const original = emailItem.items?.[itemIndex];
        const cargoItems = (emailItem.items || []).map((cargoItem, index) =>
          index === itemIndex ? { ...cargoItem, [key]: value } : cargoItem);
        const warehouseGroups = (emailItem.warehouse_groups || []).map(group => ({
          ...group,
          items: group.items.map(groupItem => original &&
            (!original.source_file || group.source_files.includes(String(original.source_file))) &&
            String(groupItem.source_row ?? "") === String(original.source_row ?? "") &&
            String(groupItem.product_code ?? "") === String(original.product_code ?? "") &&
            String(groupItem.container_assignment ?? "") === String(original.container_assignment ?? "")
              ? { ...groupItem, [key]: value } : groupItem),
        }));
        return { ...emailItem, items: cargoItems, warehouse_groups: warehouseGroups };
      });
      return { ...current, items };
    });
  }

  async function confirmBatch() {
    const activeBatch = email ? emailBatch : sheetBatch;
    if (!activeBatch) return;
    setConfirmLoading(true); setEmailError("");
    try {
      const response = email
        ? await fetch(apiPath("/api/imports/email/confirm"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(emailBatch) })
        : await fetch(apiPath(`/api/imports/spreadsheet/${sheetBatch!.import_batch_id}/confirm`), { method: "POST" });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || "确认保存失败");
      setConfirmed(true);
      if (email) setCreatedTaskIds(result.shipment_task_ids || []);
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : "确认保存失败");
    } finally { setConfirmLoading(false); }
  }

  return <div className="content import-center">
    <div className="tabs"><button className={email ? "active" : ""} onClick={() => setTab("email")}><Inbox size={16} />邮件解析</button><button className={!email ? "active" : ""} onClick={() => setTab("sheet")}><FileSpreadsheet size={16} />表格解析</button></div>
    <section className="panel import-panel"><div className="compact-upload"><span className="upload-icon">{email ? <Inbox size={23} /> : <FileSpreadsheet size={23} />}</span><div className="upload-copy"><h2>{email ? "导入邮件及附件" : "导入业务表格"}</h2><p>{email ? (emailFiles.length ? `已选择 ${emailFiles.length} 封 EML 邮件` : "支持一次选择多封EML；单封失败不会中断整批") : (sheetFiles.length ? `已选择 ${sheetFiles.length} 个表格` : "支持排期、库存、验货、包装资料等Excel/CSV文件")}</p></div><input ref={fileInput} type="file" accept={email ? ".eml,message/rfc822" : ".xlsx,.xls,.xlsm,.csv"} multiple style={{display:"none"}} onChange={event => email ? setEmailFiles(Array.from(event.target.files || [])) : setSheetFiles(Array.from(event.target.files || []))} /><div className="upload-actions"><button className="primary-button" onClick={() => fileInput.current?.click()}><Upload size={16} />选择文件</button>{(email ? emailFiles.length : sheetFiles.length) > 0 && <button className="secondary-button" disabled={emailLoading} onClick={email ? parseSelectedEmails : parseSelectedSheets}>{emailLoading ? "解析中…" : "开始批量解析"}</button>}</div></div>{emailError && <div className="notice"><span>{emailError}</span></div>}</section>
    <section className="panel preview-panel"><div className="panel-title"><div><h2>解析结果预览</h2><p>{(email ? emailBatch : sheetBatch) ? `批次共 ${(email ? emailBatch : sheetBatch)!.total} 个：成功 ${(email ? emailBatch : sheetBatch)!.parsed}，失败 ${(email ? emailBatch : sheetBatch)!.failed}` : `选择${email ? "邮件" : "表格"}并解析后，在这里人工核对`}</p></div><b className={`status ${confirmed ? "ok" : (email ? emailBatch : sheetBatch)?.failed ? "danger" : "warn"}`}>{confirmed ? "已确认" : (email ? emailBatch : sheetBatch) ? "待确认" : "未解析"}</b></div>
      {email && emailBatch && <div className="email-review-layout">
        <div className="email-review-list">{emailBatch.items.map((item,index) => <button key={`${item.filename}-${index}`} className={selectedEmailIndex === index ? "active" : ""} onClick={() => setSelectedEmailIndex(index)}><strong>#{index + 1} {item.filename}</strong><small>{item.status === "failed" ? "解析失败" : item.duplicate_of_item_id ? "重复邮件" : item.message?.subject || "无主题"}</small></button>)}</div>
        <div className="email-review-detail">
          {selectedEmail?.error && <div className="notice"><span>{selectedEmail.error}</span></div>}
          {selectedEmail?.duplicate_of_item_id && <div className="notice"><span>该邮件与记录 #{selectedEmail.duplicate_of_item_id} 重复，请确认是否继续保留。</span></div>}
          <div className="mail-meta"><span><b>主题</b>{selectedEmail?.message?.subject || "—"}</span><span><b>发件人</b>{selectedEmail?.message?.sender || "—"}</span></div>
        <div className="form-grid">{fields.map(([label,value], index) => { const key = ["so_number","container_type","ship_date","si_deadline","cutoff_date","port","destination_country","special_requirements"][index]; const deadline=key==="si_deadline"||key==="cutoff_date"; return <label key={label} className={key === "special_requirements" ? "full-width" : ""}><span>{label}</span>{key === "special_requirements" ? <textarea rows={4} value={String(value)} disabled={confirmed || selectedEmail?.status === "failed"} onChange={event => updateField(key, event.target.value)} /> : <input type={key === "ship_date" ? "date" : deadline ? "datetime-local" : "text"} value={key === "ship_date" ? dateControlValue(String(value)) : deadline ? dateControlValue(String(value),true) : String(value)} disabled={confirmed || selectedEmail?.status === "failed"} onChange={event => updateField(key, event.target.value)} />}</label>; })}</div>
          {!!selectedEmail?.warehouse_groups?.length && <div className="review-section"><h3>分柜/多仓分组</h3><div className="warehouse-grid">{selectedEmail.warehouse_groups.map((group,index) => <article key={`${group.warehouse}-${index}`}><label><span>仓库</span><input value={group.warehouse} disabled={confirmed} onChange={event => updateWarehouse(index,event.target.value)} /></label>{group.container_type&&<small>柜型：{group.container_type}</small>}<small>SO/附件编号：{group.references.join("、")}</small><strong>{group.items.length} 条货物明细</strong></article>)}</div></div>}
          {!!selectedEmail?.items?.length && <div className="review-section"><h3>货物明细 <small>共{selectedEmail.items.length}条，可在确认前修改</small></h3><div className="review-items editable"><div><b>货号</b><b>货名</b><b>规格</b><b>合同号</b><b>客户PO</b><b>数量</b><b>件数</b><b>体积</b><b>卡板</b><b>生产工厂</b></div>{selectedEmail.items.map((item,index) => { const fields = ["product_code","product_name","spec","contract_number","customer_po","quantity","pieces","volume","pallet_count","supplier"]; return <div key={index}>{fields.map(key => {const raw=key==="supplier"?(item.supplier||item.factory_remark):item[key];return <input key={key} value={key==="spec"?fullSpecification(raw):itemDisplayValue(key,raw)} disabled={confirmed} aria-label={`${key}-${index + 1}`} onChange={event => updateEmailItem(index,key,key==="spec"?specificationValue(event.target.value):event.target.value)} />;})}</div>; })}</div></div>}
          {!!selectedEmail?.warnings?.length && <div className="notice"><span>{selectedEmail.warnings.join("；")}</span></div>}
        </div>
      </div>}
      {!email && sheetBatch && <div className="email-review-layout"><div className="email-review-list">{sheetBatch.items.map((item,index) => <button key={`${item.filename}-${index}`} className={selectedEmailIndex === index ? "active" : ""} onClick={() => setSelectedEmailIndex(index)}><strong>#{index + 1} {item.filename}</strong><small>{item.status === "failed" ? "解析失败" : `${item.kind || "通用"} · ${item.sheet || ""}`}</small></button>)}</div><div className="email-review-detail">{selectedSheet?.error && <div className="notice"><span>{selectedSheet.error}</span></div>}{!!selectedSheet?.rows?.length && <div className="review-section"><h3>识别明细 <small>共{selectedSheet.rows.length}条，仅展示前20条</small></h3><div className="sheet-review-table"><div><b>货号</b><b>客户PO</b><b>合同号</b><b>数量</b><b>库存</b><b>排期/出货日期</b><b>验货结果</b></div>{selectedSheet.rows.slice(0,20).map((row,index) => <div key={index}><span>{String(row.product_code ?? "—")}</span><span>{String(row.customer_po ?? "—")}</span><span>{String(row.contract_number ?? "—")}</span><span>{String(row.quantity ?? "—")}</span><span>{String(row.inventory_quantity ?? "—")}</span><span>{String(row.planned_date ?? "—")}</span><span>{String(row.inspection_result ?? "—")}</span></div>)}</div></div>}{!!selectedSheet?.warnings?.length && <div className="notice"><span>{selectedSheet.warnings.join("；")}</span></div>}</div></div>}
      {((email && !emailBatch) || (!email && !sheetBatch)) && <div className="form-grid">{fields.map(([label,value]) => <label key={label}><span>{label}</span><input value={String(value)} readOnly /></label>)}</div>}
      <div className="notice"><ListChecks size={18} /><span>{email ? "邮件确认后即可创建走柜任务和制表；库存、验货未确认时仅显示提示，不阻断操作。" : "确认后保存表格解析结果，并用于更新对应业务资料。"}</span></div>
      {confirmed && email && <div className="task-created-result"><span>{createdTaskIds.length ? `已自动创建或更新 ${createdTaskIds.length} 个走柜任务` : "本批邮件未新增任务（重复邮件不会重复创建）"}</span>{createdTaskIds.length === 1 ? <Link href={`/shipments/${createdTaskIds[0]}`}>打开任务</Link> : createdTaskIds.length > 1 ? <Link href="/shipments">查看任务列表</Link> : null}</div>}
      <div className="panel-actions"><button className="ghost-button" onClick={() => { setEmailBatch(null); setSheetBatch(null); setEmailFiles([]); setSheetFiles([]); setConfirmed(false); setCreatedTaskIds([]); }}>取消本次导入</button><button className="primary-button" disabled={!(email ? emailBatch : sheetBatch) || confirmed || confirmLoading || !!(email ? emailBatch : sheetBatch)?.failed} onClick={confirmBatch}><Check size={16} />{confirmLoading ? "保存中…" : confirmed ? "已确认" : "确认本批次"}</button></div>
    </section>
  </div>;
}

function ShipmentCenter({ route, role }: { route:string; role:UserRole }) {
  const router=useRouter();
  const detailId = route.split("/")[1];
  const [view, setView] = useState<"calendar" | "tasks" | "done">("tasks");
  const [tasks, setTasks] = useState<ShipmentTaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating,setCreating]=useState(false); const [createDraft,setCreateDraft]=useState({customer:"",soNumber:"",containerType:"",plannedShipDate:"",port:""}); const [createSaving,setCreateSaving]=useState(false);
  async function loadTasks() {
    setLoading(true); setError("");
    try {
      const response = await fetch(apiPath("/api/shipments"), { cache:"no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取走柜任务失败");
      setTasks(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "读取走柜任务失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (!detailId) void loadTasks(); }, [detailId]);
  async function createTask(event:React.FormEvent){event.preventDefault();setCreateSaving(true);setError("");try{const response=await fetch(apiPath("/api/shipments"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(createDraft)});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"新建任务失败");setCreating(false);router.push(`/shipments/${result.id}`);}catch(reason){setError(reason instanceof Error?reason.message:"新建任务失败");}finally{setCreateSaving(false);}}
  async function deleteTask(task:ShipmentTaskData){if(!window.confirm(`是否删除任务“${task.customer} / ${task.soNumber||"SO待确认"}”及其邮件解析记录？\n\n删除后可重新导入原邮件，产品信息和产品映射不会删除。`))return;setError("");try{const response=await fetch(apiPath(`/api/shipments/${task.id}`),{method:"DELETE"});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"删除任务失败");setTasks(current=>current.filter(value=>value.id!==task.id));}catch(reason){setError(reason instanceof Error?reason.message:"删除任务失败");}}
  if (detailId) return <ShipmentDetail id={detailId} role={role} />;
  return <div className="content">
    <div className="page-heading"><div><p className="eyebrow">核心业务模块</p><h1>走柜任务</h1><p>查看走柜安排、复核制表信息，并在车辆离厂后完成任务。</p></div>{role!=="warehouse"&&<button className="primary-button" onClick={()=>setCreating(true)}><Plus size={16}/>新建走柜任务</button>}</div>
    <div className="tabs"><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}><CalendarDays size={16} />日历安排</button><button className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")}><ListChecks size={16} />任务列表</button><button className={view === "done" ? "active" : ""} onClick={() => setView("done")}><Check size={16} />完成汇总</button></div>
    {error && <div className="notice"><span>{error}</span></div>}
    {loading ? <section className="panel shipment-loading">正在读取走柜任务…</section> : view === "calendar" ? <CalendarBoard tasks={tasks} /> : <TaskBoard tasks={tasks} completed={view === "done"} onDelete={deleteTask} />}
    {creating&&<div className="mapping-modal-backdrop" onMouseDown={()=>setCreating(false)}><form className="mapping-modal" onSubmit={createTask} onMouseDown={event=>event.stopPropagation()}><div><h2>新建走柜任务</h2><p>先填写基本资料，建立后进入任务详情补充货物明细并复核。</p></div><div className="mapping-form-grid"><label><span>客户 / 洋行 *</span><input autoFocus required value={createDraft.customer} onChange={event=>setCreateDraft({...createDraft,customer:event.target.value})}/></label><label><span>SO号</span><input value={createDraft.soNumber} onChange={event=>setCreateDraft({...createDraft,soNumber:event.target.value})}/></label><label><span>柜型</span><input placeholder="例如：1*40HQ" value={createDraft.containerType} onChange={event=>setCreateDraft({...createDraft,containerType:event.target.value})}/></label><label><span>计划走货日期</span><input type="date" value={createDraft.plannedShipDate} onChange={event=>setCreateDraft({...createDraft,plannedShipDate:event.target.value})}/></label><label><span>装货港</span><input value={createDraft.port} onChange={event=>setCreateDraft({...createDraft,port:event.target.value})}/></label></div><div className="mapping-modal-actions"><button type="button" className="ghost-button" onClick={()=>setCreating(false)}>取消</button><button className="primary-button" disabled={createSaving}>{createSaving?"建立中…":"建立并打开任务"}</button></div></form></div>}
  </div>;
}

function CalendarBoard({ tasks }: { tasks:ShipmentTaskData[] }) {
  const today = new Date();
  const dateKey = (value:Date) => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
  const [month,setMonth]=useState(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`);
  const [year,monthNumber]=month.split("-").map(Number);const first=new Date(year,monthNumber-1,1);const gridStart=new Date(first);gridStart.setDate(1-first.getDay());const days=Array.from({length:42},(_,index)=>{const value=new Date(gridStart);value.setDate(gridStart.getDate()+index);return value;});
  const activeTasks = tasks.filter(task => task.status !== "Completed" && task.status !== "Cancelled");
  const unscheduled = activeTasks.filter(task => !task.plannedShipDate);
  return <><section className="panel"><div className="panel-title"><div><h2>{year}年{monthNumber}月</h2><p>月视图；默认走货日期为截关日期前一天</p></div><div className="calendar-actions range"><label><span>查看月份</span><input type="month" value={month} onChange={event=>setMonth(event.target.value)}/></label></div></div>
    <div className="calendar-weekdays">{"日一二三四五六".split("").map(value=><b key={value}>周{value}</b>)}</div><div className="calendar-grid month-grid">{days.map(day => { const key=dateKey(day); const dayTasks=activeTasks.filter(task => task.plannedShipDate===key); const classes=["calendar-day",key===dateKey(today)?"today":"",day.getMonth()!==monthNumber-1?"outside-month":""].filter(Boolean).join(" ");return <div className={classes} key={key}><strong>{day.getDate()}</strong>{dayTasks.map(task => <Link className={`schedule-card ${task.status === "PendingReview" ? "orange" : "green"}`} href={`/shipments/${task.id}`} key={task.id}><strong>{task.customer}</strong><small>{task.containerType || "柜型待确认"} · {shipmentStatus[task.status]}</small></Link>)}</div>; })}</div>
  </section>{unscheduled.length > 0 && <section className="panel unscheduled-panel"><div><h2>未安排日期</h2><p>以下任务未识别到截关日期，请进入详情选择走货日期。</p></div><div>{unscheduled.map(task => <Link key={task.id} href={`/shipments/${task.id}`}>{task.customer}<small>{task.containerType || "柜型待确认"}</small></Link>)}</div></section>}</>;
}

function TaskBoard({ tasks, completed, onDelete }: { tasks:ShipmentTaskData[]; completed:boolean; onDelete:(task:ShipmentTaskData)=>Promise<void> }) {
  const [query,setQuery] = useState(""); const [customer,setCustomer] = useState(""); const [status,setStatus] = useState("");
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
  const [dateFrom,setDateFrom] = useState(completed ? `${currentMonth}-01` : "");
  const [dateTo,setDateTo] = useState(completed ? new Date(new Date().getFullYear(),new Date().getMonth()+1,0).toISOString().slice(0,10) : "");
  const customers = Array.from(new Set(tasks.map(task => task.customer))).sort();
  const visible = tasks.filter(task => {
    if (completed && task.status !== "Completed") return false;
    if (!completed && task.status === "Completed") return false;
    if (customer && task.customer !== customer) return false;
    if (status && task.status !== status) return false;
    const targetDate = completed ? task.completedDate : task.plannedShipDate;
    if (dateFrom && (!targetDate || targetDate < dateFrom)) return false;
    if (dateTo && (!targetDate || targetDate > dateTo)) return false;
    const text = `${task.customer} ${task.soNumber || ""} ${task.items.map(item => `${item.product_code || ""} ${item.customer_po || ""}`).join(" ")}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  });
  const total = (key:string) => visible.reduce((sum,task) => sum + task.items.reduce((inner,item) => inner + Number(item[key] || 0),0),0);
  return <section className="panel data-panel"><div className="filters"><label className="filter-input"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索客户、SO、PO或货号" /></label>{!completed&&<><select className="filter-select" value={customer} onChange={event => setCustomer(event.target.value)}><option value="">全部客户</option>{customers.map(value => <option key={value}>{value}</option>)}</select><select className="filter-select" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option><option value="PendingReview">待复核</option><option value="PendingShipment">待走货</option><option value="Cancelled">已取消</option></select></>}<label className="date-range-filter"><span>{completed?"完成日期":"计划日期"}</span><input type="date" value={dateFrom} max={dateTo||undefined} onChange={event=>setDateFrom(event.target.value)}/><i>至</i><input type="date" value={dateTo} min={dateFrom||undefined} onChange={event=>setDateTo(event.target.value)}/></label></div>
    {completed && <div className="monthly-summary"><span><b>{visible.length}</b> 柜</span><span>总数量 <b>{total("quantity")}</b></span><span>总件数 <b>{total("pieces")}</b></span><span>总体积 <b>{total("volume").toFixed(2)} CBM</b></span><a className="ghost-button action-shipping" href={apiPath(`/api/shipments/completed/summary/export?from=${dateFrom}&to=${dateTo}`)}><Download size={14}/>导出走柜任务汇总</a></div>}
    <div className={`data-table shipment-table numbered ${completed?"":"with-task-time"}`}><div className="data-row header"><span>编号</span><span>客户 / SO</span><span>{completed ? "完成日期" : "计划日期"}</span><span>柜型</span><span>数量</span><span>件数</span><span>验货结果</span><span>状态</span><span>操作</span>{!completed&&<span>任务时间</span>}</div>{visible.map(task => {const time=taskTimeDisplay(task);return <div className="data-row" key={task.id}><span>#{task.id}</span><span><b>{task.customer}</b><small>{task.soNumber || "SO待确认"}</small></span><span>{completed ? task.completedDate : task.plannedShipDate || "待安排"}</span><span>{task.containerType || "—"}</span><span>{task.items.reduce((sum,item)=>sum+Number(item.quantity||0),0)}</span><span>{task.items.reduce((sum,item)=>sum+Number(item.pieces||0),0)}</span><span><b className="qc-pending">待接入</b></span><span><b className={`status ${task.status === "Completed" ? "ok" : task.status === "Cancelled" ? "danger" : "warn"}`}>{shipmentStatus[task.status]}</b></span><span className="task-row-actions"><Link className="table-action" href={`/shipments/${task.id}`}>打开任务</Link><button className="icon-danger task-delete-icon" title="删除任务" aria-label={`删除任务 ${task.customer} ${task.soNumber||"SO待确认"}`} onClick={()=>void onDelete(task)}><Trash2 size={14}/></button></span>{!completed&&<span className="task-time"><b>{time.label}</b><small>{time.value}</small></span>}</div>})}</div>
    {!visible.length && <div className="shipment-empty">当前条件下没有任务</div>}
  </section>;
}

function InventoryCenter({route,role}:{route:string;role:UserRole}) {
  const detailId=route.split("/")[2];
  const now=new Date(); const month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const [from,setFrom]=useState(`${month}-01`); const [to,setTo]=useState(new Date(now.getFullYear(),now.getMonth()+1,0).toISOString().slice(0,10));
  const [tasks,setTasks]=useState<ShipmentTaskData[]>([]); const [error,setError]=useState(""); const [writebackNotice,setWritebackNotice]=useState("");
  const [localScan,setLocalScan]=useState<LocalInventoryScan|null>(null); const [scanning,setScanning]=useState(false); const [writing,setWriting]=useState(false);
  useEffect(()=>{void(async()=>{try{const response=await fetch(apiPath("/api/shipments"),{cache:"no-store"});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"读取出库记录失败");setTasks(result);}catch(reason){setError(reason instanceof Error?reason.message:"读取出库记录失败");}})();},[]);
  async function scanLocalInventory(){setScanning(true);setError("");try{const {handle,files}=await authorizedInventoryFiles(role);const form=new FormData();files.forEach(file=>form.append("files",file,file.name));form.append("folder",handle.name);const response=await fetch(apiPath("/api/inventory/local-files/scan"),{method:"POST",body:form});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"读取本地库存表失败");setLocalScan(result);}catch(reason){setError(reason instanceof Error?reason.message:"读取本地库存表失败");}finally{setScanning(false);}}
  async function writeAllPendingInventory(){
    const eligible=tasks.filter(task=>task.status==="PendingShipment"&&!!task.plannedShipDate&&task.plannedShipDate>=from&&task.plannedShipDate<=to)
      .filter(task=>!task.items.some(item=>String(item.inventory_writeback_task_id||"")===String(task.id))&&!window.localStorage.getItem(`voyageplex-inventory-writeback-${task.id}`))
      .sort((left,right)=>String(left.plannedShipDate).localeCompare(String(right.plannedShipDate))||left.id-right.id);
    if(!eligible.length){setError("所选日期范围内没有待回写的待走货任务");return;}
    const emptyTask=eligible.find(task=>!task.items.length);
    if(emptyTask){setError(`任务 #${emptyTask.id} 没有货物明细，已停止批量回写`);return;}
    const missingTrips=eligible.filter(task=>!task.transportReference?.trim()).map(task=>`#${task.id}`);
    const tripWarning=missingTrips.length?`\n\n提醒：编号 ${missingTrips.join("、")} 的任务没有车次，仍然允许回写。`:"";
    if(!window.confirm(`确认按先进先出规则，一次回写 ${eligible.length} 个未回写任务？${tripWarning}`))return;
    setWriting(true);setError("");setWritebackNotice("");
    try{
      const {handle,files}=await authorizedInventoryFiles(role);
      const today=new Date().toLocaleDateString("sv-SE");
      const flatItems:Array<Record<string,unknown>>=[];const flatIndex=new Map<string,number>();
      eligible.forEach(task=>task.items.forEach((item,itemIndex)=>{flatIndex.set(`${task.id}:${itemIndex}`,flatItems.length);flatItems.push({...item,writeback_task_id:String(task.id),outbound_date:today,outbound_trip:task.transportReference||""});}));
      const form=new FormData();files.forEach(file=>form.append("files",file,file.name));
      form.append("payload",JSON.stringify({task_id:`batch-${Date.now()}`,outbound_date:today,items:flatItems}));
      const response=await fetch(apiPath("/api/inventory/local-files/writeback"),{method:"POST",body:form});const result=await readJsonResponse(response);
      if(!response.ok||result.error)throw new Error(result.error||"批量库存回写失败");
      await applyInventoryWritebackFiles(handle,Array.isArray(result.files)?result.files:[]);
      const writtenAt=new Date().toISOString();const allocations=Array.isArray(result.allocations)?result.allocations:[];
      eligible.forEach(task=>window.localStorage.setItem(`voyageplex-inventory-writeback-${task.id}`,writtenAt));
      const savedTasks=new Map<number,ShipmentTaskData>();
      for(const task of eligible){
        const writtenItems=task.items.map((item,itemIndex)=>{const index=flatIndex.get(`${task.id}:${itemIndex}`);return {...item,inventory_writeback_task_id:String(task.id),inventory_writeback_at:writtenAt,inventory_writeback_date:String(result.outbound_date||today),inventory_writeback_allocations:allocations.filter((allocation:Record<string,unknown>)=>Number(allocation.item_index)===index)};});
        const saveResponse=await fetch(apiPath(`/api/shipments/${task.id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:writtenItems,status:"Completed"})});const saved=await readJsonResponse(saveResponse);
        if(!saveResponse.ok)throw new Error(`库存已写入，但任务 #${task.id} 完成状态保存失败，请联系管理员`);
        savedTasks.set(task.id,saved);
      }
      setTasks(current=>current.map(task=>savedTasks.get(task.id)||task));
      setWritebackNotice(`批量回写成功：${eligible.length} 个任务已走货完成，更新 ${Number(result.updated_rows||0)} 行库存，已生成原表备份`);
    }catch(reason){setError(reason instanceof Error?reason.message:"批量库存回写失败");}finally{setWriting(false);}
  }
  if(detailId)return <ShipmentDetail id={detailId} role="warehouse" directoryRole={role} backHref="/inventory" backLabel="返回出库任务" />;
  const pendingWriteback=tasks.filter(task=>task.status==="PendingShipment"&&!!task.plannedShipDate&&task.plannedShipDate>=from&&task.plannedShipDate<=to)
    .filter(task=>!task.items.some(item=>String(item.inventory_writeback_task_id||"")===String(task.id)));
  const outboundTasks=tasks.filter(task=>task.status==="PendingShipment"||task.status==="Completed");
  const taskTotal=(task:ShipmentTaskData,key:string)=>task.items.reduce((sum,item)=>sum+Number(item[key]||0),0);
  const locationState=(task:ShipmentTaskData)=>{const matched=task.items.filter(item=>item.warehouse_location).length;return matched===task.items.length&&matched>0?"已查询":matched>0?`${matched}/${task.items.length} 已匹配`:"待查询";};
  return <div className="content"><PageHeading eyebrow="库存资料与出库处理" title="库存管理" description="集中查询库存匹配结果，并将待走货任务批量回写到本地库存表。" />
    <section className="panel local-inventory-source"><div className="panel-title"><div><h2>本地库存数据源</h2><p>读取当前用户在“系统设置”中授权的本地库存文件夹。</p></div><button className="ghost-button action-location" disabled={scanning} onClick={()=>void scanLocalInventory()}><RefreshCw size={14}/>{scanning?"读取中…":"读取本地库存表"}</button></div>{localScan&&<><div className="local-inventory-summary"><span><b>{localScan.successful_files||0}</b> 个文件读取成功</span><span><b>{localScan.total_rows||0}</b> 条库存记录</span><span>目录：{localScan.folder||"—"}</span><span>扫描时间：{localScan.scanned_at?.replace("T"," ")||"—"}</span></div><div className="local-inventory-files">{localScan.files.map(file=><div key={file.filename}><span><b>{file.filename}</b><small>更新：{file.modified_at.replace("T"," ")}</small></span><span>{file.sheets.length} 个工作表</span><span>{file.row_count} 条记录</span><b className={`status ${file.status==="ok"?"ok":"danger"}`}>{file.status==="ok"?"读取成功":"读取失败"}</b></div>)}</div></>}</section>
    <section className="panel inventory-toolbar"><div><h2>一键回写库存</h2><p>按计划走货日期处理待走货任务，回写成功后自动标记为走货完成。</p></div><label className="date-range-filter"><span>计划走货日期</span><input type="date" value={from} max={to} onChange={event=>setFrom(event.target.value)}/><i>至</i><input type="date" value={to} min={from} onChange={event=>setTo(event.target.value)}/></label><button className="ghost-button action-inventory" disabled={writing||!pendingWriteback.length} onClick={()=>void writeAllPendingInventory()}><Check size={14}/>{writing?"回写中…":`一键回写 ${pendingWriteback.length} 个任务`}</button></section>
    {writebackNotice&&<div className="notice">{writebackNotice}</div>}{error&&<div className="notice">{error}</div>}<section className="panel data-panel"><div className="panel-title inventory-list-title"><div><h2>出库任务</h2><p>一柜一行；打开后查询放货区、核对数量和件数并生成仓务走柜表。</p></div><div className="inventory-task-stats"><span><b>{outboundTasks.filter(task=>task.status!=="Completed").length}</b> 个待出库</span><span><b>{pendingWriteback.length}</b> 个区间内待回写</span></div></div>
    <div className="data-table shipment-table"><div className="data-row header"><span>客户 / SO</span><span>走货日期</span><span>柜型</span><span>数量</span><span>件数</span><span>放货区</span><span>状态</span><span>操作</span></div>{outboundTasks.map(task=><div className="data-row" key={task.id}><span><b>{task.customer}</b><small>{task.soNumber||"SO待确认"}</small></span><span>{task.plannedShipDate||"待安排"}</span><span>{task.containerType||"待确认"}</span><span>{taskTotal(task,"quantity")}</span><span>{taskTotal(task,"pieces")}</span><span><b className={`status ${locationState(task)==="已查询"?"ok":"warn"}`}>{locationState(task)}</b></span><span><b className={`status ${task.status==="Completed"?"ok":"warn"}`}>{shipmentStatus[task.status]}</b></span><span><Link className="table-action" href={`/inventory/tasks/${task.id}`}>打开出库任务</Link></span></div>)}</div>
    {!outboundTasks.length&&<div className="shipment-empty">暂无出库任务</div>}</section></div>;
}

function ShipmentDetail({ id, role, directoryRole=role, backHref="/shipments", backLabel="返回走柜任务" }: { id:string; role:UserRole; directoryRole?:UserRole; backHref?:string; backLabel?:string }) {
  const router=useRouter();
  const [task,setTask] = useState<ShipmentTaskData|null>(null); const [error,setError] = useState(""); const [saving,setSaving] = useState(false); const [qcNotice,setQcNotice] = useState(""); const [queryingQc,setQueryingQc]=useState(false); const [locationNotice,setLocationNotice] = useState(""); const [refreshingLocations,setRefreshingLocations] = useState(false); const [writingBack,setWritingBack]=useState(false);
  useEffect(() => { void (async () => { try { const response=await fetch(apiPath(`/api/shipments/${id}`),{cache:"no-store"}); const result=await response.json(); if(!response.ok) throw new Error(result.error||"读取任务失败"); setTask(normalizeInventorySourceDisplay(result)); } catch(reason){setError(reason instanceof Error?reason.message:"读取任务失败");} })(); },[id]);
  async function update(changes:Record<string,string>) { if(!task)return; setSaving(true); setError(""); try { const response=await fetch(apiPath(`/api/shipments/${id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(changes)}); const result=await response.json(); if(!response.ok) throw new Error(result.error||"保存失败"); setTask(result); } catch(reason){setError(reason instanceof Error?reason.message:"保存失败");} finally{setSaving(false);} }
  async function cancelTask(){if(!task||!window.confirm("确认取消这个走柜任务？取消后不能恢复。"))return;await update({status:"Cancelled"});}
  async function deleteTask(){if(!task||!window.confirm(`是否删除任务“${task.customer} / ${task.soNumber||"SO待确认"}”及其邮件解析记录？\n\n删除后可重新导入原邮件；产品信息和产品映射不会删除。${task.items.some(item=>item.inventory_writeback_task_id)?"\n已写入本地库存的数据不会撤销。":""}`))return;setSaving(true);setError("");try{const response=await fetch(apiPath(`/api/shipments/${id}`),{method:"DELETE"});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"删除任务失败");router.push(backHref);router.refresh();}catch(reason){setError(reason instanceof Error?reason.message:"删除任务失败");setSaving(false);}}
  async function saveReview():Promise<boolean> { if(!task)return false; setSaving(true); setError(""); try { const response=await fetch(apiPath(`/api/shipments/${id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({customer:task.customer,soNumber:task.soNumber||"",containerType:task.containerType,plannedShipDate:task.plannedShipDate||"",cutoffDate:task.cutoffDate,siDeadline:task.siDeadline,port:task.port,destinationCountry:task.destinationCountry||"",transportReference:task.transportReference||"",specialRequirements:task.specialRequirements,warehouseGroups:task.warehouseGroups,items:task.items})}); const result=await readJsonResponse(response); if(!response.ok) throw new Error(result.error||"保存失败"); setTask(result); return true; } catch(reason){setError(reason instanceof Error?reason.message:"保存失败");return false;} finally{setSaving(false);} }
  async function queryQcResult(){if(!task)return;setQueryingQc(true);setQcNotice("");try{const parameters=new URLSearchParams({customer:task.customer,soNumber:task.soNumber||"",productCodes:task.items.map(item=>String(item.product_code||"")).filter(Boolean).join(",")});const response=await fetch(apiPath(`/api/qc/results?${parameters}`),{cache:"no-store"});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"查询验货结果失败");setQcNotice(result.summary||result.result||"QC系统未返回验货结果");}catch(reason){setQcNotice(reason instanceof Error?reason.message:"查询验货结果失败");}finally{setQueryingQc(false);}}
  async function saveWarehouseQuantities():Promise<boolean> { if(!task)return false; setSaving(true); setError(""); try { const response=await fetch(apiPath(`/api/shipments/${id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:task.items,transportReference:task.transportReference||""})}); const result=await readJsonResponse(response); if(!response.ok) throw new Error(result.error||"保存失败"); setTask(result); setLocationNotice("柜号/车次、数量、件数、入库单号和放货区已保存"); return true; } catch(reason){setError(reason instanceof Error?reason.message:"保存失败");return false;} finally{setSaving(false);} }
  async function exportShipment(warehouse:boolean) {
    if(saving || !task)return;
    const saved=warehouse?await saveWarehouseQuantities():await saveReview();
    if(!saved)return;
    setSaving(true);setError("");
    try{
      const response=await fetch(apiPath(`/api/shipments/${id}/${warehouse?"warehouse-export":"export"}`),{cache:"no-store"});
      if(!response.ok){const result=await readJsonResponse(response);throw new Error(result.error||"走柜表生成失败");}
      const blob=await response.blob();
      const encoded=response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename=encoded?decodeURIComponent(encoded):`走柜表-${id}.xlsx`;
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(reason){setError(reason instanceof Error?reason.message:"走柜表生成失败");}
    finally{setSaving(false);}
  }
  async function refreshWarehouseLocations() {
    if(!task)return;setRefreshingLocations(true);setError("");setLocationNotice("");
    try{
      const {files}=await authorizedInventoryFiles(directoryRole);const form=new FormData();files.forEach(file=>form.append("files",file,file.name));
      form.append("payload",JSON.stringify({customer:task.customer,items:task.items}));
      const matchResponse=await fetch(apiPath("/api/inventory/local-files/match"),{method:"POST",body:form});const matchResult=await readJsonResponse(matchResponse);
      if(!matchResponse.ok)throw new Error(matchResult.error||"查询放货区失败");
      const matches=Array.isArray(matchResult.items)?matchResult.items:[];
      const matchedItems=task.items.map((item,index)=>{
        const match=matches.find((value:Record<string,unknown>)=>Number(value.index)===index);
        if(!match)return item;
        const fullSource=Array.isArray(match.sources)?match.sources.join("；"):"";
        return {...item,warehouse_location:String(match.location||""),warehouse_match_status:String(match.status||"未匹配"),inventory_customer_name:String(match.customer_name||""),inventory_country:String(match.country||""),inventory_receipt_number:String(match.receipt_number||""),inventory_source:shortInventorySource(fullSource),inventory_source_full:fullSource};
      });
      const saveResponse=await fetch(apiPath(`/api/shipments/${id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:matchedItems})});const saved=await readJsonResponse(saveResponse);
      if(!saveResponse.ok)throw new Error(saved.error||"保存查询结果失败");setTask(saved);
      setLocationNotice(`已重新读取本地库存表，${matches.filter((value:Record<string,unknown>)=>Number(value.match_count)>0).length} 条明细已更新`);
    }catch(reason){setError(reason instanceof Error?reason.message:"查询放货区失败");}finally{setRefreshingLocations(false);}
  }
  async function confirmInventoryWriteback(){if(!task)return;if(task.status!=="PendingShipment"){setError("只有待走货任务可以回写库存");return;}const operationKey=`voyageplex-inventory-writeback-${task.id}`;if(window.localStorage.getItem(operationKey)||task.items.some(item=>String(item.inventory_writeback_task_id||"")===String(task.id))){setError("该走柜任务已经回写库存，不能重复扣减");return;}const tripWarning=task.transportReference?.trim()?"":`\n\n提醒：编号 #${task.id} 的任务没有车次，仍然允许回写。`;if(!window.confirm(`确认按先进先出规则，将本任务数量作为今日出库写回本地库存表？回写成功后任务将自动变为走货完成。${tripWarning}`))return;setWritingBack(true);setError("");setLocationNotice("");try{const {handle,files}=await authorizedInventoryFiles(directoryRole);const form=new FormData();files.forEach(file=>form.append("files",file,file.name));const today=new Date().toLocaleDateString("sv-SE");form.append("payload",JSON.stringify({task_id:task.id,outbound_date:today,items:task.items.map(item=>({...item,outbound_trip:task.transportReference||""}))}));const response=await fetch(apiPath("/api/inventory/local-files/writeback"),{method:"POST",body:form});const result=await readJsonResponse(response);if(!response.ok||result.error)throw new Error(result.error||"库存回写失败");for(const output of result.files||[]){const backupHandle=await handle.getFileHandle(String(output.backup_filename),{create:true});const backupWriter=await backupHandle.createWritable();await backupWriter.write(decodeBase64(String(output.backup_base64)));await backupWriter.close();const targetHandle=await handle.getFileHandle(String(output.filename),{create:false});const targetWriter=await targetHandle.createWritable();await targetWriter.write(decodeBase64(String(output.content_base64)));await targetWriter.close();}window.localStorage.setItem(operationKey,new Date().toISOString());const allocations=Array.isArray(result.allocations)?result.allocations:[];const writtenItems=task.items.map((item,index)=>({...item,inventory_writeback_task_id:String(task.id),inventory_writeback_at:new Date().toISOString(),inventory_writeback_date:String(result.outbound_date||today),inventory_writeback_allocations:allocations.filter((allocation:Record<string,unknown>)=>Number(allocation.item_index)===index)}));const saveResponse=await fetch(apiPath(`/api/shipments/${id}`),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:writtenItems,status:"Completed"})});const saved=await readJsonResponse(saveResponse);if(!saveResponse.ok)throw new Error(saved.error||"库存已写入，但任务完成状态保存失败，请联系管理员");setTask(saved);setLocationNotice(`库存回写成功：更新 ${Number(result.updated_rows||0)} 行，任务已走货完成，并已生成原表备份`);}catch(reason){setError(reason instanceof Error?reason.message:"库存回写失败");}finally{setWritingBack(false);}}
  function changeField(key:keyof ShipmentTaskData,value:string) { if(task)setTask({...task,[key]:value}); }
  function changeWarehouse(value:string) { if(!task)return; const groups=task.warehouseGroups.length ? task.warehouseGroups.map((group,index)=>index===0?{...group,warehouse:value}:group) : [{warehouse:value,references:[],items:[],source_files:[]}]; setTask({...task,warehouseGroups:groups}); }
  function changeItem(index:number,key:string,value:string) { if(!task)return; setTask({...task,items:task.items.map((item,row)=>row===index?{...item,[key]:value}:item)}); }
  function removeItem(index:number) { if(task)setTask({...task,items:task.items.filter((_,row)=>row!==index)}); }
  function addItem() { if(task)setTask({...task,items:[...task.items,{product_code:"",product_name:"",spec:"",customer_po:"",contract_number:"",quantity:"",pieces:"",pallet_count:"",gross_weight:"",net_weight:"",volume:"",box_dimensions:"",supplier:""}]}); }
  if (!task) return <div className="content"><Link className="back-button" href={backHref}><ArrowLeft size={15}/>{backLabel}</Link>{error ? <div className="notice">{error}</div> : <section className="panel shipment-loading">正在读取任务…</section>}</div>;
  const warehouseUser=role==="warehouse";
  if(warehouseUser&&task.status!=="PendingShipment"&&task.status!=="Completed")return <div className="content"><Link className="back-button" href={backHref}><ArrowLeft size={15}/>{backLabel}</Link><section className="panel shipment-loading"><h2>任务尚未移交仓务</h2><p>船务复核完成并将状态改为“待走货”后，仓务才能查看和操作此任务。</p></section></div>;
  const sum=(key:string)=>task.items.reduce((total,item)=>total+Number(item[key]||0),0);
  const itemFields=["customer","contract_number","product_code","product_name","spec","quantity","pieces","gross_weight","net_weight","volume","customer_po","order_total_pieces","gross_weight_per_box","net_weight_per_box",...(warehouseUser?["inventory_receipt_number","warehouse_location","inventory_source"]:[]),"pallet_count","loading_factory"];
  const writebackRecord=task.items.find(item=>String(item.inventory_writeback_task_id||"")===String(task.id));
  const taskTitle=`${task.customer} · ${task.emailSubject?.trim()||task.soNumber?.trim()||`任务 #${task.id}`}`;
  return <div className="content shipment-detail"><Link className="back-button" href={backHref}><ArrowLeft size={15}/>{backLabel}</Link><div className="page-heading shipment-detail-heading"><div><p className="eyebrow">走柜任务 #{task.id}</p><h1 title={taskTitle}>{taskTitle}</h1></div><div className="heading-status-actions"><select className="heading-status-select" aria-label="任务状态" value={task.status} disabled={saving||warehouseUser||task.status!=="PendingReview"} onChange={event=>void update({status:event.target.value})}><option value={task.status}>{shipmentStatus[task.status]}</option>{task.status==="PendingReview"&&<option value="PendingShipment" disabled={!task.plannedShipDate}>{task.plannedShipDate?"待走货":"待走货（请先填写日期）"}</option>}</select>{!warehouseUser&&(task.status==="PendingReview"||task.status==="PendingShipment")&&<button className="ghost-button action-cancel" disabled={saving} onClick={()=>void cancelTask()}>取消任务</button>}<button className="ghost-button action-delete" disabled={saving} onClick={()=>void deleteTask()}><Trash2 size={14}/>删除任务</button></div></div>{error&&<div className="notice">{error}</div>}
    <section className="panel shipment-core"><div className="shipment-fields"><label className="field-so"><span>SO号</span><input value={task.soNumber||""} disabled={warehouseUser} placeholder="SO待确认" onChange={event=>changeField("soNumber",event.target.value)}/></label><label className="field-container"><span>柜型</span><input value={task.containerType||""} disabled={warehouseUser} placeholder="待确认" onChange={event=>changeField("containerType",event.target.value)}/></label><label className="field-transport"><span>柜号/车次</span><input value={task.transportReference||""} disabled={saving} placeholder="待手工录入" onChange={event=>changeField("transportReference",event.target.value)}/></label><label className="field-date"><span>计划走货日期</span><input type="date" value={task.plannedShipDate||""} disabled={saving||warehouseUser} onChange={event=>changeField("plannedShipDate",event.target.value)}/><small>转为待走货前必须填写</small></label><label className="field-cutoff"><span>截关日期</span><input type="datetime-local" value={dateControlValue(task.cutoffDate,true)} disabled={warehouseUser} onChange={event=>changeField("cutoffDate",event.target.value)}/></label><label className="field-si"><span>SI 截止期</span><input type="datetime-local" value={dateControlValue(task.siDeadline,true)} disabled={warehouseUser} onChange={event=>changeField("siDeadline",event.target.value)}/></label><label className="field-port"><span>装货港</span><input value={task.port||""} disabled={warehouseUser} placeholder="待确认" onChange={event=>changeField("port",event.target.value)}/></label><label className="field-destination"><span>收货地</span><input value={task.destinationCountry||""} disabled={warehouseUser} placeholder="待确认" onChange={event=>changeField("destinationCountry",event.target.value)}/></label>{!warehouseUser&&<div className="shipment-actions field-actions"><div className="shipment-action-buttons"><button className="primary-button" onClick={()=>void saveReview()} disabled={saving}>{saving?"保存中…":"保存核对修改"}</button><button className="ghost-button action-shipping" disabled={saving} onClick={()=>void exportShipment(false)}>生成船务走柜表</button></div></div>}</div>{warehouseUser&&<div className="shipment-actions warehouse-actions"><div className="shipment-action-buttons"><button className="primary-button" onClick={()=>void saveWarehouseQuantities()} disabled={saving||task.status!=="PendingShipment"}>{saving?"保存中…":"保存仓务修改"}</button><button className="ghost-button action-location" onClick={()=>void refreshWarehouseLocations()} disabled={refreshingLocations||task.status!=="PendingShipment"}>{refreshingLocations?"查询中…":"查询/刷新放货区"}</button><button className="ghost-button action-warehouse" disabled={saving} onClick={()=>void exportShipment(true)}>生成仓务走柜表</button><button className="ghost-button action-writeback" disabled={writingBack||Boolean(writebackRecord)||task.status!=="PendingShipment"} onClick={()=>void confirmInventoryWriteback()}>{writingBack?"回写中…":writebackRecord?"今日出库已回写":task.status==="Completed"?"任务已走货完成":"确认今日出库并回写"}</button></div>{locationNotice&&<small className="action-notice">{locationNotice}</small>}</div>}</section>
    <section className="shipment-metrics"><article><span>货物明细</span><b>{task.items.length} 条</b></article><article><span>总体积</span><b>{sum("volume").toFixed(2)} CBM</b></article></section>
    {warehouseUser&&writebackRecord&&<section className="panel writeback-log"><div><h2>库存回写记录</h2><p>任务 #{task.id} 已扣减，系统已拦截重复回写。</p></div><div><b>{String(writebackRecord.inventory_writeback_date||"—")}</b><small>{String(writebackRecord.inventory_writeback_at||"").replace("T"," ").slice(0,19)}</small></div></section>}
    <section className="panel shipment-notes editable"><label><span>制表备注</span><textarea value={task.specialRequirements||""} disabled={warehouseUser} placeholder="无特殊要求" onChange={event=>changeField("specialRequirements",event.target.value)}/></label><div className="qc-placeholder"><div><h2>验货结果</h2><p>{qcNotice||"点击查询 QC 验货系统结果"}</p></div>{!warehouseUser&&<button className="ghost-button" disabled={queryingQc} onClick={()=>void queryQcResult()}><RefreshCw size={14}/>{queryingQc?"查询中…":"查询验货结果"}</button>}</div></section>
    <section className={`panel shipment-items editable ${warehouseUser?"warehouse-view":"shipping-view"}`}><div className="panel-title"><div><h2>货物明细</h2><p>{warehouseUser?"放货区和入库单号从本地库存表查询，仓务可人工修正":"核对走柜货物资料、数量和装箱信息"}</p></div>{!warehouseUser&&<button className="ghost-button" onClick={addItem}><Plus size={14}/>新增明细</button>}</div><div className="shipment-item-table"><div><b>洋行</b><b>合同</b><b>货号</b><b>货名</b><b>规格</b><b>数量</b><b>件数</b><b>毛重</b><b>净重</b><b>体积</b><b>客人PO</b><b>每单总件数</b><b>每箱毛重</b><b>每箱净重</b>{warehouseUser&&<><b>入库单号</b><b>放货区</b><b>来源表</b></>}<b>卡板</b><b>做柜工厂</b><b>操作</b></div>{task.items.map((item,index)=><div key={index}>{itemFields.map(key=>{const derived=key==="customer";const warehouseEditable=key==="quantity"||key==="pieces"||key==="inventory_receipt_number"||key==="warehouse_location";const warehouseLocked=warehouseUser&&(task.status!=="PendingShipment"||!warehouseEditable);const inventoryField=key==="inventory_receipt_number"||key==="warehouse_location";const pendingWeight=key==="gross_weight"||key==="net_weight";const raw=key==="customer"?task.customer:item[key];return <input key={key} className={inventoryField?"inventory-match-input":""} aria-label={`${key}-${index+1}`} title={key==="inventory_source"?String(item.inventory_source_full||item.inventory_source||""):undefined} disabled={derived||warehouseLocked} placeholder={pendingWeight?"待货品资料":key==="inventory_receipt_number"?"待查询入库单":key==="warehouse_location"?"待查询放货区":key==="inventory_source"?"待查询来源表":""} value={key==="spec"?fullSpecification(raw):itemDisplayValue(key,raw)} onChange={event=>changeItem(index,key,key==="spec"?specificationValue(event.target.value):event.target.value)}/>})}{warehouseUser?<span>{task.status==="PendingShipment"?"可保存":"只读"}</span>:<button className="icon-danger" aria-label={`删除第${index+1}条明细`} onClick={()=>removeItem(index)}><Trash2 size={14}/></button>}</div>)}</div></section>
  </div>;
}

function UserManagement({currentUser}:{currentUser:CurrentUser}){
  const empty={username:"",displayName:"",role:"shipping" as UserRole,password:""};
  const [users,setUsers]=useState<CurrentUser[]>([]);const [draft,setDraft]=useState(empty);const [editing,setEditing]=useState<CurrentUser|null>(null);const [error,setError]=useState("");const [notice,setNotice]=useState("");const [saving,setSaving]=useState(false);
  async function load(){const response=await fetch(apiPath("/api/users"),{cache:"no-store"});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"读取用户失败");setUsers(result);}
  useEffect(()=>{void load().catch(reason=>setError(reason instanceof Error?reason.message:"读取用户失败"));},[]);
  async function create(event:React.FormEvent){event.preventDefault();setSaving(true);setError("");setNotice("");try{const response=await fetch(apiPath("/api/users"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(draft)});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"新增用户失败");setDraft(empty);setNotice("用户已创建");await load();}catch(reason){setError(reason instanceof Error?reason.message:"新增用户失败");}finally{setSaving(false);}}
  async function saveEdit(event:React.FormEvent){event.preventDefault();if(!editing)return;setSaving(true);setError("");setNotice("");try{const response=await fetch(apiPath(`/api/users/${editing.id}`),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:editing.displayName,role:editing.role,isActive:editing.isActive})});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"保存失败");setEditing(null);setNotice("用户资料已更新");await load();}catch(reason){setError(reason instanceof Error?reason.message:"保存失败");}finally{setSaving(false);}}
  async function toggle(user:CurrentUser){setError("");setNotice("");const response=await fetch(apiPath(`/api/users/${user.id}`),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:user.displayName,role:user.role,isActive:!user.isActive})});const result=await readJsonResponse(response);if(!response.ok){setError(result.error||"操作失败");return;}setNotice(user.isActive?"用户已停用":"用户已启用");await load();}
  async function resetPassword(user:CurrentUser){const password=window.prompt(`请输入 ${user.displayName} 的新密码（至少8位）`);if(!password)return;setError("");setNotice("");const response=await fetch(apiPath(`/api/users/${user.id}/reset-password`),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});const result=await readJsonResponse(response);if(!response.ok){setError(result.error||"重置密码失败");return;}setNotice("密码已重置，该用户需要重新登录");}
  return <div className="content"><PageHeading eyebrow="管理员功能" title="用户管理" description="创建系统账号并按岗位分配使用权限。" />
    <form className="panel user-create-form" onSubmit={create}><div className="panel-title"><div><h2>新增用户</h2><p>账号创建后即可登录系统</p></div></div><div className="user-form-grid"><label><span>登录账号</span><input value={draft.username} onChange={event=>setDraft({...draft,username:event.target.value.toLowerCase()})} placeholder="例如 shipping01" required minLength={3}/></label><label><span>姓名</span><input value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})} required/></label><label><span>角色</span><select value={draft.role} onChange={event=>setDraft({...draft,role:event.target.value as UserRole})}><option value="shipping">船务员</option><option value="warehouse">仓库文员</option><option value="admin">管理员</option></select></label><label><span>初始密码</span><input type="password" value={draft.password} onChange={event=>setDraft({...draft,password:event.target.value})} minLength={8} required/></label><button className="primary-button" disabled={saving}>{saving?"创建中…":"新增用户"}</button></div></form>
    {(error||notice)&&<div className={error?"form-error page-message":"form-notice page-message"}>{error||notice}</div>}
    <section className="panel user-list"><div className="panel-title"><div><h2>系统用户</h2><p>共 {users.length} 个账号</p></div></div><div className="data-table"><div className="data-row header"><span>用户</span><span>角色</span><span>状态</span><span>最后登录</span><span>操作</span></div>{users.map(user=><div className="data-row" key={user.id}><span><b>{user.displayName}</b><small>{user.username}</small></span><span>{roleLabel(user.role)}</span><span><b className={`status ${user.isActive?"ok":"danger"}`}>{user.isActive?"启用":"停用"}</b></span><span>{user.lastLoginAt?new Date(user.lastLoginAt).toLocaleString("zh-CN"):"尚未登录"}</span><span className="user-actions"><button className="table-action" onClick={()=>setEditing({...user})}>编辑</button><button className="table-action" onClick={()=>void resetPassword(user)}>重置密码</button><button className="table-action danger-text" disabled={user.id===currentUser.id} onClick={()=>void toggle(user)}>{user.isActive?"停用":"启用"}</button></span></div>)}</div></section>
    {editing&&<div className="modal-backdrop"><form className="modal-card" onSubmit={saveEdit}><h2>编辑用户</h2><p>{editing.username}</p><label><span>姓名</span><input value={editing.displayName} onChange={event=>setEditing({...editing,displayName:event.target.value})} required/></label><label><span>角色</span><select value={editing.role} onChange={event=>setEditing({...editing,role:event.target.value as UserRole})}><option value="shipping">船务员</option><option value="warehouse">仓库文员</option><option value="admin">管理员</option></select></label><label className="checkbox-label"><input type="checkbox" checked={editing.isActive} disabled={editing.id===currentUser.id} onChange={event=>setEditing({...editing,isActive:event.target.checked})}/>账号启用</label><div className="modal-actions"><button type="button" className="ghost-button" onClick={()=>setEditing(null)}>取消</button><button className="primary-button" disabled={saving}>保存</button></div></form></div>}
  </div>;
}

function SettingsCenter({role}:{role:UserRole}) {
  const [section, setSection] = useState<"home" | "inspection-mapping" | "product-info">("home");
  const [localFolder,setLocalFolder]=useState("");
  const [directoryMessage,setDirectoryMessage]=useState("");
  useEffect(()=>{void loadConfiguredDirectory(role).then(handle=>setLocalFolder(handle?.name||""));},[role]);
  async function chooseLocalFolder(){setDirectoryMessage("");try{const picker=(window as Window & {showDirectoryPicker?:()=>Promise<LocalDirectoryHandle>}).showDirectoryPicker;if(!picker)throw new Error("当前浏览器不支持文件夹授权，请使用最新版 Chrome 或 Edge");const handle=await picker();const permission=await handle.requestPermission({mode:"readwrite"});if(permission!=="granted")throw new Error("未获得文件夹读写权限");await saveLocalDirectory(role,handle);setLocalFolder(handle.name);setDirectoryMessage("本地库存文件夹已保存，仅对当前用户和当前浏览器生效");}catch(reason){if(reason instanceof DOMException&&reason.name==="AbortError")return;setDirectoryMessage(reason instanceof Error?reason.message:"选择文件夹失败");}}
  if (section === "inspection-mapping") return <InspectionMappingSettings onBack={() => setSection("home")} />;
  if (section === "product-info") return <ProductInfoSettings onBack={() => setSection("home")} />;
  return <div className="content"><PageHeading eyebrow="基础配置" title="系统设置" description="按用户权限配置本地文件夹、共享盘目录、导入规则和模板。" />
    {directoryMessage&&<div className="notice">{directoryMessage}</div>}
    <div className="settings-grid">
      <section className="panel setting-card directory-setting-card"><Database size={22}/><div><h2>文件夹目录</h2><p>本地库存：{localFolder||"尚未设置"}</p><small>{role==="admin"?"管理员":role==="warehouse"?"仓务文员":"船务用户"}的独立本地配置</small></div><button className="ghost-button" onClick={()=>void chooseLocalFolder()}>{localFolder?"重新选择":"选择文件夹"}</button><div className="directory-shared-row"><span><b>共享盘目录</b><small>仅管理员可以设置，本次保持原配置</small></span><button className="ghost-button" disabled>{role==="admin"?"待配置":"仅管理员"}</button></div></section>
      <section className="panel setting-card"><FileSpreadsheet size={22}/><div><h2>字段映射</h2><p>管理不同客户、工厂和表格的字段对应规则。</p></div><button className="ghost-button">配置</button></section>
      <section className="panel setting-card"><Container size={22}/><div><h2>走柜表模板</h2><p>管理整柜与拼柜使用的现有Excel模板。</p></div><button className="ghost-button">配置</button></section>
      <section className="panel setting-card"><MappingIcon size={22}/><div><h2>验货映射</h2><p>按车间管理货号、负责人和验货总结表来源。</p></div><button className="ghost-button" onClick={() => setSection("inspection-mapping")}>管理</button></section>
      <section className="panel setting-card"><Database size={22}/><div><h2>产品信息库</h2><p>管理装箱规格、毛净重及旧系统产品资料。</p></div><button className="ghost-button" onClick={() => setSection("product-info")}>管理</button></section>
    </div>
  </div>;
}

function ProductInfoSettings({onBack}:{onBack:()=>void}) {
  const empty:ProductInfo={id:0,legacyId:0,customer:"",productCode:"",productName:"",quantityPerBox:null,toyCategory:"",factoryRemark:"",grossWeightPerBox:null,netWeightPerBox:null,source:"manual"};
  const [rows,setRows]=useState<ProductInfo[]>([]),[customers,setCustomers]=useState<string[]>([]),[customer,setCustomer]=useState(""),[query,setQuery]=useState(""),[page,setPage]=useState(1),[total,setTotal]=useState(0);
  const [editing,setEditing]=useState<ProductInfo|null>(null),[loading,setLoading]=useState(true),[message,setMessage]=useState(""); const fileInput=useRef<HTMLInputElement>(null); const pageSize=50;
  async function load(target=page){setLoading(true);try{const params=new URLSearchParams({page:String(target),pageSize:String(pageSize)});if(query.trim())params.set("query",query.trim());if(customer)params.set("customer",customer);const response=await fetch(apiPath(`/api/product-infos?${params}`),{cache:"no-store"});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"读取产品资料失败");setRows(result.items);setCustomers(result.customers);setTotal(result.total);setPage(result.page);}catch(reason){setMessage(reason instanceof Error?reason.message:"读取产品资料失败");}finally{setLoading(false);}}
  useEffect(()=>{void load(1);},[customer]);
  async function importCsv(file?:File){if(!file)return;setLoading(true);setMessage("");const body=new FormData();body.append("file",file);try{const response=await fetch(apiPath("/api/product-infos/import"),{method:"POST",body});const result=await readJsonResponse(response);if(!response.ok)throw new Error(result.error||"导入失败");setMessage(`已导入 ${result.imported} 条；跳过 ${result.skippedCrossCustomerCodeCount} 个跨客户货号（${result.skippedCrossCustomerRows} 行），合并 ${result.supersededRows} 条旧版本`);await load(1);}catch(reason){setMessage(reason instanceof Error?reason.message:"导入失败");setLoading(false);}}
  async function save(event:React.FormEvent){event.preventDefault();if(!editing)return;const response=await fetch(editing.id?apiPath(`/api/product-infos/${editing.id}`):apiPath("/api/product-infos"),{method:editing.id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(editing)});const result=await readJsonResponse(response);if(!response.ok){setMessage(result.error||"保存失败");return;}setEditing(null);setMessage("产品资料已保存");await load();}
  async function remove(row:ProductInfo){if(!window.confirm(`确认删除货号 ${row.productCode}？`))return;const response=await fetch(apiPath(`/api/product-infos/${row.id}`),{method:"DELETE"});if(!response.ok){setMessage("删除失败");return;}setMessage(`已删除货号 ${row.productCode}`);await load();}
  const pages=Math.max(1,Math.ceil(total/pageSize)); const numberValue=(value:string)=>value===""?null:Number(value);
  return <div className="content inspection-mapping-page"><button className="back-button" onClick={onBack}><ArrowLeft size={15}/>返回系统设置</button>
    <div className="page-heading mapping-heading"><div><p className="eyebrow">产品基础资料</p><h1>产品信息库</h1><p>每个货号可保留不同装箱规格；同规格导入时以旧系统记录ID最大的资料为最新版。</p></div><div className="mapping-actions"><button className="ghost-button" onClick={()=>setEditing({...empty})}><Plus size={15}/>新增产品</button><input ref={fileInput} hidden type="file" accept=".csv" onChange={event=>{void importCsv(event.target.files?.[0]);event.target.value="";}}/><button className="primary-button" disabled={loading} onClick={()=>fileInput.current?.click()}><Upload size={16}/>{loading?"处理中…":"导入旧系统CSV"}</button></div></div>
    <div className="mapping-summary"><span><b>{total}</b> 条产品规格</span><span><b>{customers.length}</b> 个客户</span><span>资料来源：旧船务系统货号映射</span></div>{message&&<div className="notice mapping-message">{message}</div>}
    <section className="panel mapping-card"><div className="mapping-card-head"><div><h2>产品资料</h2><p>跨两个或以上非空客户的货号不会导入。</p></div><div className="product-filters"><select value={customer} onChange={event=>setCustomer(event.target.value)}><option value="">全部客户</option>{customers.map(value=><option key={value}>{value}</option>)}</select><div className="mapping-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void load(1);}} placeholder="搜索客户、货号或货名"/></div><button className="ghost-button" onClick={()=>void load(1)}>搜索</button></div></div>
      <div className="mapping-table"><div className="product-row header"><span>客户</span><span>货号</span><span>货名</span><span>每箱个数</span><span>类别</span><span>柜单备注</span><span>毛重kg</span><span>净重kg</span><span>来源</span><span>操作</span></div>{rows.map(row=><div className="product-row" key={row.id}><span>{row.customer||"—"}</span><span className="product-code">{row.productCode}</span><span>{row.productName||"—"}</span><span>{row.quantityPerBox??"默认"}</span><span>{row.toyCategory||"—"}</span><span>{row.factoryRemark||"—"}</span><span>{row.grossWeightPerBox??"—"}</span><span>{row.netWeightPerBox??"—"}</span><span>{row.source||"—"}</span><span className="mapping-row-actions"><button onClick={()=>setEditing({...row})}>编辑</button><button className="delete" onClick={()=>void remove(row)}><Trash2 size={12}/></button></span></div>)}</div>
      {!rows.length&&<div className="mapping-empty">{loading?"正在读取产品资料…":"没有找到符合条件的产品"}</div>}<div className="product-pagination"><span>第 {page} / {pages} 页</span><div><button className="ghost-button" disabled={page<=1||loading} onClick={()=>void load(page-1)}>上一页</button><button className="ghost-button" disabled={page>=pages||loading} onClick={()=>void load(page+1)}>下一页</button></div></div></section>
    {editing&&<div className="mapping-modal-backdrop" onMouseDown={()=>setEditing(null)}><form className="mapping-modal" onSubmit={save} onMouseDown={event=>event.stopPropagation()}><div><h2>{editing.id?"编辑产品资料":"新增产品资料"}</h2><p>货号与每箱个数组合不能重复。</p></div><div className="mapping-form-grid">{[["客户","customer"],["货号","productCode"],["货名","productName"],["玩具类别","toyCategory"],["柜单备注","factoryRemark"],["来源","source"]].map(([label,key])=><label key={key}><span>{label}</span><input required={key==="productCode"} value={String(editing[key as keyof ProductInfo]??"")} onChange={event=>setEditing(current=>current?{...current,[key]:event.target.value}:current)}/></label>)}{[["每箱个数","quantityPerBox"],["每箱毛重(kg)","grossWeightPerBox"],["每箱净重(kg)","netWeightPerBox"]].map(([label,key])=><label key={key}><span>{label}</span><input type="number" min="0.001" step={key==="quantityPerBox"?"1":"0.001"} value={String(editing[key as keyof ProductInfo]??"")} onChange={event=>setEditing(current=>current?{...current,[key]:numberValue(event.target.value)}:current)}/></label>)}</div><div className="panel-actions"><button type="button" className="ghost-button" onClick={()=>setEditing(null)}>取消</button><button className="primary-button">保存</button></div></form></div>}
  </div>;
}

function InspectionMappingSettings({ onBack }: { onBack: () => void }) {
  const [mappings, setMappings] = useState<StoredInspectionMapping[]>([]);
  const [activeGroupName, setActiveGroupName] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StoredInspectionMapping | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const groups = Array.from(new Map(mappings.map(row => [row.groupName, {
    name: row.groupName, inspectionSource: row.inspectionSource, excluded: row.isExcluded,
    description: row.groupName === "华嘉" ? "华嘉货号统一在兴信验货总结表中查询" : row.isExcluded ? "河源自行做柜，系统保留映射但不读取验货结果" : undefined,
  }])).values());
  const group = groups.find(item => item.name === activeGroupName) || groups[0];
  const normalizedQuery = query.trim().toLowerCase();
  const rows = mappings.filter(row => row.groupName === group?.name && (!normalizedQuery || Object.values(row).some(value => String(value).toLowerCase().includes(normalizedQuery))));

  async function loadMappings() {
    setLoading(true);
    try {
      const response = await fetch(apiPath("/api/inspection-mappings"));
      if (!response.ok) throw new Error("读取验货映射失败");
      const result = await response.json() as StoredInspectionMapping[];
      setMappings(result);
      if (!activeGroupName && result.length) setActiveGroupName(result[0].groupName);
    } catch (error) { setMessage(error instanceof Error ? error.message : "读取验货映射失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadMappings(); }, []);

  async function importWorkbook(file?: File) {
    if (!file) return;
    setLoading(true); setMessage("");
    const body = new FormData(); body.append("file", file);
    try {
      const response = await fetch(apiPath("/api/inspection-mappings/import"), { method:"POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "导入失败");
      setActiveGroupName(""); setMessage(`已从 ${result.filename} 更新 ${result.total} 条映射`);
      await loadMappings();
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); setLoading(false); }
  }

  async function saveMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const response = await fetch(editing.id ? apiPath(`/api/inspection-mappings/${editing.id}`) : apiPath("/api/inspection-mappings"), {
      method: editing.id ? "PUT" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(editing),
    });
    if (!response.ok) { setMessage("保存失败，请重试"); return; }
    setEditing(null); setMessage("验货映射已保存"); await loadMappings();
  }

  async function deleteMapping(row: StoredInspectionMapping) {
    if (!window.confirm(`确认删除货号 ${row.productCode}？`)) return;
    const response = await fetch(apiPath(`/api/inspection-mappings/${row.id}`), { method:"DELETE" });
    if (!response.ok) { setMessage("删除失败，请重试"); return; }
    setMessage(`已删除货号 ${row.productCode}`); await loadMappings();
  }

  function newMapping() {
    setEditing({ id:0, groupName:group?.name || "兴信A车间", inspectionSource:group?.inspectionSource || "兴信验货总结表", isExcluded:group?.excluded || false, customer:"", productCode:"", productName:"", owner:"", productionPlace:"", note:"" });
  }
  return <div className="content inspection-mapping-page">
    <button className="back-button" onClick={onBack}><ArrowLeft size={15}/>返回系统设置</button>
    <div className="page-heading mapping-heading"><div><p className="eyebrow">验货基础资料</p><h1>验货映射</h1><p>按跟单负责货号表管理；系统据此确定货号应查询的验货总结表。</p></div><div className="mapping-actions"><button className="ghost-button" onClick={newMapping}><Plus size={15}/>新增映射</button><input ref={importInput} type="file" accept=".xlsx,.xlsm" hidden onChange={event => { void importWorkbook(event.target.files?.[0]); event.target.value=""; }} /><button className="primary-button" disabled={loading} onClick={() => importInput.current?.click()}><Upload size={16}/>{loading ? "处理中…" : "导入更新"}</button></div></div>
    <div className="mapping-summary"><span><b>{groups.length}</b> 个车间分组</span><span><b>{mappings.length}</b> 条映射</span><span>资料来源：跟单负责货号.xlsx</span></div>
    {message && <div className="notice mapping-message"><span>{message}</span></div>}
    <div className="mapping-layout">
      <aside className="mapping-groups" aria-label="车间分组">{groups.map(item => <button key={item.name} className={group?.name === item.name ? "active" : ""} onClick={() => { setActiveGroupName(item.name); setQuery(""); }}><span>{item.name}</span><small>{mappings.filter(row => row.groupName === item.name).length} 条 · {item.inspectionSource}</small></button>)}</aside>
      <section className="panel mapping-card">
        {group && <><div className="mapping-card-head"><div><div className="mapping-title-line"><h2>{group.name}</h2><b className={`status ${group.excluded ? "warn" : "ok"}`}>{group.inspectionSource}</b></div><p>{group.description || `该分组货号从${group.inspectionSource}读取验货结果。`}</p></div><div className="mapping-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索客户、货号、货名或负责人" /></div></div>
        <div className="mapping-table"><div className="mapping-row header"><span>客户</span><span>货号</span><span>货名</span><span>负责人</span><span>生产地</span><span>备注</span><span>操作</span></div>{rows.map(row => <div className="mapping-row" key={row.id}><span>{row.customer || "—"}</span><span className="product-code">{row.productCode}</span><span>{row.productName || "—"}</span><span>{row.owner || "—"}</span><span>{row.productionPlace || "—"}</span><span>{row.note || "—"}</span><span className="mapping-row-actions"><button onClick={() => setEditing(row)}>编辑</button><button className="delete" onClick={() => void deleteMapping(row)}><Trash2 size={12}/></button></span></div>)}</div>
        {!rows.length && <div className="mapping-empty">{loading ? "正在读取验货映射…" : "没有找到符合条件的货号"}</div>}</>}
        {!group && <div className="mapping-empty">{loading ? "正在读取验货映射…" : "暂无验货映射，请点击“导入更新”选择跟单负责货号表"}</div>}
      </section>
    </div>
    {editing && <div className="mapping-modal-backdrop" onMouseDown={() => setEditing(null)}><form className="mapping-modal" onSubmit={saveMapping} onMouseDown={event => event.stopPropagation()}><div><h2>{editing.id ? "编辑验货映射" : "新增验货映射"}</h2><p>填写货号所属分组及基础资料。</p></div><div className="mapping-form-grid">{[
      ["车间分组","groupName"],["验货表来源","inspectionSource"],["客户","customer"],["货号","productCode"],["货名","productName"],["负责人","owner"],["生产地","productionPlace"],["备注","note"],
    ].map(([label,key]) => <label key={key}><span>{label}</span><input required={key === "groupName" || key === "inspectionSource" || key === "productCode"} value={String(editing[key as keyof StoredInspectionMapping] ?? "")} onChange={event => setEditing(current => current ? {...current,[key]:event.target.value} : current)} /></label>)}</div><label className="mapping-check"><input type="checkbox" checked={editing.isExcluded} onChange={event => setEditing(current => current ? {...current,isExcluded:event.target.checked} : current)} />不参与系统验货检查</label><div className="panel-actions"><button type="button" className="ghost-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" type="submit">保存</button></div></form></div>}
  </div>;
}

function PageHeading({ eyebrow,title,description,action }: { eyebrow:string; title:string; description:string; action?:string }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action && <button className="primary-button"><Upload size={16}/>{action}</button>}</div>; }
function PanelTitle({title,subtitle,link}:{title:string;subtitle:string;link?:string}) { return <div className="panel-title"><div><h2>{title}</h2><p>{subtitle}</p></div>{link && <Link href={link}>查看全部 <ChevronRight size={15}/></Link>}</div>; }
