export type UserCategory="all"|"partial"|"viewer";
export type Permission=
  |"view_dashboard"|"view_complaints"|"manage_complaints"|"delete_complaints"
  |"view_analysis"|"manage_classification"|"manage_translation"|"import_data"
  |"view_cap"|"manage_cap"|"view_reports"|"export_reports"|"manage_users"|"manage_settings"|"view_audit";

export const permissionLabels:Record<Permission,string>={
  view_dashboard:"查看仪表盘",view_complaints:"查看投诉数据",manage_complaints:"新增与编辑投诉",delete_complaints:"删除投诉",
  view_analysis:"查看分析与质量情报",manage_classification:"管理问题类型与系列",manage_translation:"管理翻译",
  import_data:"导入数据",view_cap:"查看 CAP",manage_cap:"管理 CAP",view_reports:"查看报告",export_reports:"导出报告",
  manage_users:"管理用户",manage_settings:"系统设置与数据恢复",view_audit:"查看操作日志"
};
export const allPermissions=Object.keys(permissionLabels) as Permission[];
export const categoryLabels:Record<UserCategory,string>={all:"所有权限",partial:"部分权限",viewer:"查看权限"};
export const defaultPermissions:Record<UserCategory,Permission[]>={
  all:[...allPermissions],
  partial:["view_dashboard","view_complaints","manage_complaints","view_analysis","manage_classification","manage_translation","import_data","view_cap","manage_cap","view_reports","export_reports"],
  viewer:["view_dashboard","view_complaints","view_analysis","view_cap","view_reports"]
};

export interface ToyQMSUser{
  id:string;name:string;responsibility:string;loginName:string;category:UserCategory;permissions:Permission[];
  enabled:boolean;mustChangePassword:boolean;passwordSalt:string;passwordHash:string;createdAt:string;updatedAt:string;isPrimary:boolean;
}
export type PublicUser=Omit<ToyQMSUser,"passwordSalt"|"passwordHash">;

export const routePermission:Record<string,Permission>={
  "/dashboard":"view_dashboard","/complaints":"view_complaints","/series-analysis":"view_analysis","/quality-intelligence":"view_analysis",
  "/ai-classification":"manage_classification","/translation":"manage_translation","/import":"import_data","/cap":"view_cap","/reports":"view_reports",
  "/series-management":"manage_classification","/issue-types":"manage_classification","/users":"manage_users","/settings":"manage_settings","/audit-log":"view_audit"
};

export function normalizeLoginName(value:string){return value.trim().toLocaleLowerCase("zh-CN")}
export function hasPermission(user:PublicUser|null|undefined,permission:Permission){return Boolean(user?.enabled&&user.permissions.includes(permission))}
