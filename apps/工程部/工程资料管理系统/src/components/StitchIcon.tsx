import {
  Settings, LayoutDashboard, Database, GitBranch, Workflow, Wrench, ShieldCheck,
  GitCompare, Trash2, Search, History, Shield, Rocket, Flag, ClipboardCheck,
  CheckCircle2, ArrowRightLeft, Circle, TriangleAlert, Table2, Lock, Save,
  Send, Undo2, Image, Grid3X3, List, BookOpen, Users, FolderOpen, ListChecks, Lightbulb,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  tune: Settings, space_dashboard: LayoutDashboard, dataset: Database,
  account_tree: GitBranch, developer_board: Workflow, precision_manufacturing: Wrench,
  verified: ShieldCheck, difference: GitCompare, inventory: Trash2, search: Search,
  update: History, security: Shield, rocket_launch: Rocket, flag: Flag,
  rate_review: ClipboardCheck, verified_user: ShieldCheck, alt_route: ArrowRightLeft,
  check_circle: CheckCircle2, radio_button_unchecked: Circle,
  notification_important: TriangleAlert, table_chart: Table2, lock: Lock, save: Save,
  send: Send, undo: Undo2, shield_lock: ShieldCheck, image: Image, grid_on: Grid3X3,
  list_alt: List, menu_book: BookOpen, group: Users, folder_open: FolderOpen,
  fact_check: ListChecks, tips_and_updates: Lightbulb, apps: Grid3X3,
};
export function StitchIcon({ name, className }: { name: string; className?: string }) {
  const Icon = icons[name] || Circle;
  return <Icon aria-hidden="true" focusable="false" className={className}
    style={{ width: "1em", height: "1em", flexShrink: 0 }} />;
}
