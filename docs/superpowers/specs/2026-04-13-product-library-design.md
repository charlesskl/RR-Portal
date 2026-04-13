# 产品资料库（product-library）设计文档

- **日期**：2026-04-13
- **作者**：胡帆 + Claude（brainstorming session）
- **状态**：待 review
- **插件文件夹**：`plugins/product-library/`
- **部门**：Engineering
- **访问路径**：`/product-library/`

## 1. 背景与目标

### 痛点
工程师产品资料（作业指导书、生产注意事项、外箱资料、外购清单、排模表等 Excel）分散保存在各自电脑里，版本更新频繁后容易搞混、弄丢、找不到。

### 目标
- 集中存储所有产品资料，按"客户 → 产品"两级筛选定位
- 每次更新自动保留历史版本，永不丢失
- 支持按产品一键打包导出，文件夹结构与工程师本地习惯完全一致
- 工程师全员可查，负责人/管理员可写

## 2. 技术架构

### 技术栈
- **后端**：Node.js + Express（与 工程啤办单 / zouhuo 一致）
- **数据库**：PostgreSQL（平台已有实例，独立 schema `product_library`）
- **前端**：原生 HTML + Vanilla JS（或轻量 Vue，参考现有插件风格）
- **文件存储**：本地 bind mount，抽象为 `StorageProvider` 接口，未来一行配置切 OSS
- **认证**：对接 RR Portal 核心登录系统（JWT），不单独建用户

### 服务架构
```
浏览器
  ↓ (Nginx /product-library/)
Node.js + Express (端口 3003)
  ├─ Routes 层：REST API + 页面路由
  ├─ Service 层：产品/版本/权限/导出业务
  └─ Storage 层：StorageProvider 接口
       ├─ LocalStorage（当前）  →  ./data/files/
       └─ OSSStorage（未来）    →  阿里云 OSS
  ↓
PostgreSQL (schema: product_library)
```

### 与 RR Portal 集成
- 插件通过 Nginx 子路径接入，不影响其他服务
- 登录态通过 RR Portal 核心 JWT token 验证
- 菜单挂在 Engineering 部门下
- 独立于 工程啤办单（不共用数据库 schema，不共用代码）

## 3. 数据模型

### 3.1 表结构（PostgreSQL schema: `product_library`）

**customers（客户）** — 管理员维护
- `id` SERIAL PK
- `name` VARCHAR 唯一（如 "Toy Monster"）
- `code` VARCHAR 可选（如 "TM"）
- `created_at` TIMESTAMP

**factories（工厂）** — 预置"华登"、"兴信"，管理员可增
- `id` SERIAL PK
- `name` VARCHAR 唯一
- `code` VARCHAR

**products（产品）** — 工程师新建
- `id` SERIAL PK
- `customer_id` FK → customers
- `series` VARCHAR（系列，如 "暴力熊"）
- `product_code` VARCHAR（如 "T02428"）
- `product_name` VARCHAR（如 "9.5寸暴力熊"）
- `size` VARCHAR（如 "9.5寸"）
- `owner_user_id` FK → 核心 users 表
- `created_at`, `updated_at` TIMESTAMP

**product_factory（产品×工厂）** — 产品在哪些工厂生产
- `id` SERIAL PK
- `product_id` FK → products
- `factory_id` FK → factories
- UNIQUE (product_id, factory_id)

**document_slots（资料槽位）** — 每个产品×工厂 5 个预置槽位 + 可追加
- `id` SERIAL PK
- `product_factory_id` FK → product_factory
- `slot_type` VARCHAR（如 "作业指导书"）
- `slot_name` VARCHAR（显示名，默认等于 slot_type）
- `is_preset` BOOLEAN（预置槽位 true，追加槽位 false）
- `sort_order` INT

**document_versions（版本）** — 每次上传产生一条，永不删
- `id` SERIAL PK
- `slot_id` FK → document_slots
- `version_no` INT（1, 2, 3…）
- `filename` VARCHAR（原文件名）
- `file_path` VARCHAR（Storage key，如 `{pid}/{fid}/{sid}/v1_20260413_xxx.xlsx`）
- `file_size` BIGINT
- `uploaded_by` FK → 核心 users 表
- `uploaded_at` TIMESTAMP
- `remark` VARCHAR 可选（如 "客户确认版"）

### 3.2 筛选主路径
`customers → products → product_factory → document_slots → document_versions`

## 4. 预置槽位类型

新建 `product_factory` 时自动创建以下 5 个槽位（`is_preset=true`）：

1. 作业指导书
2. 生产注意事项
3. 外箱资料
4. 外购清单
5. 排模表

追加槽位：`is_preset=false`，工程师在产品详情页自由新建。

## 5. 页面与功能

### 5.1 首页 / 客户列表
- 左侧客户导航
- 全局搜索：按客户名/产品编号/产品名称模糊搜索
- 顶部切换："所有产品" / "我负责的产品"

### 5.2 客户详情页（产品列表）
- 表格：产品编号 / 产品名称 / 系列 / 尺寸 / 负责工程师 / 最后更新 / 工厂覆盖标识（华登✓ 兴信✗）
- 排序与筛选：按系列、负责人、更新时间
- 右上角："新建产品"

### 5.3 产品详情页
- 顶部：产品基本信息（可编辑，仅负责人/管理员）
- 工厂标签页：动态渲染该产品覆盖的工厂（华登 / 兴信）
- 每标签页下：槽位列表（5 预置 + 追加），每槽位显示：
  - 最新版：文件名、版本号、上传时间、上传人、备注
  - 操作：下载 / 查看历史版本 / 上传新版本（仅负责人或管理员）
- 历史版本展开：列出所有版本，每行可下载
- "追加新槽位"按钮
- 右上角："打包下载此产品"（zip）

### 5.4 上传版本弹窗
- 文件选择（拖拽/点击），Excel 为主但不限类型
- 可选备注
- 提交后 `version_no = max(已有) + 1`

### 5.5 新建产品向导
- 步骤：选客户（下拉）→ 填系列/产品编号/产品名/尺寸 → 选负责工程师 → 勾选覆盖工厂（华登/兴信/两者）
- 提交后：创建 product 记录、创建选中的 product_factory 记录、为每个 product_factory 创建 5 个预置槽位（空）

### 5.6 管理员后台
- 客户管理（增删改）
- 工厂管理（增改，默认华登/兴信）
- 预置槽位类型管理（默认 5 种，可增）

## 6. 权限矩阵

| 操作 | 游客 | 普通工程师 | 负责工程师 | 管理员 |
|---|---|---|---|---|
| 浏览/下载任何产品 | ❌ | ✅ | ✅ | ✅ |
| 新建产品 | ❌ | ✅ | ✅ | ✅ |
| 编辑产品信息 | ❌ | ❌ | ✅（自己的） | ✅ |
| 上传新版本 / 追加槽位 | ❌ | ❌ | ✅（自己的） | ✅ |
| 删除产品 | ❌ | ❌ | ❌ | ✅ |
| 管理客户/工厂 | ❌ | ❌ | ❌ | ✅ |

"负责工程师" = `products.owner_user_id == current_user.id`

## 7. 文件存储

### 7.1 磁盘布局（当前：本地 bind mount）
```
plugins/product-library/
├── app/
├── Dockerfile
├── package.json
├── .env
└── data/
    └── files/
        └── {product_id}/
            └── {factory_id}/
                └── {slot_id}/
                    ├── v1_20260301_作业指导书.xlsx
                    ├── v2_20260315_作业指导书.xlsx
                    └── v3_20260413_作业指导书.xlsx
```

路径使用数字 ID 避免中文路径在 Linux/Docker 下的编码问题。原文件名保留在数据库 `filename` 字段与磁盘文件名尾部。

### 7.2 存储抽象接口
```javascript
// storage/provider.js
class StorageProvider {
  async save(key, buffer) {}    // 存文件
  async read(key) {}            // 读 Stream
  async delete(key) {}
  async exists(key) {}
}

// storage/local.js    -- fs 实现
// storage/oss.js      -- 未来阿里云 OSS 实现

// 环境变量 STORAGE_TYPE=local|oss 决定实例化哪个
```

业务代码只依赖接口，切换 OSS 仅改配置。

### 7.3 导出 zip 结构
打包下载时，用数据库元数据动态生成中文文件夹：
```
{客户名}/
  {系列}/
    {产品编号} {产品名称}/
      {工厂名}/
        {最新版原文件名}.xlsx
```

## 8. 部署

### 8.1 Docker
- 新服务 `product-library`，内部端口 3003
- `docker-compose.yml` 新增：
  ```yaml
  product-library:
    build:
      context: .
      dockerfile: plugins/product-library/Dockerfile
    env_file: plugins/product-library/.env
    volumes:
      - ./plugins/product-library/data:/app/data
    networks:
      - platform-net
    restart: unless-stopped
  ```

### 8.2 Nginx
```
location /product-library/ {
  proxy_pass http://product-library:3003/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  client_max_body_size 200M;   # Excel 单文件可达 30M
}
```

### 8.3 数据库初始化
`scripts/init-db.sql` 新增：
```sql
CREATE SCHEMA IF NOT EXISTS product_library;
```
建表脚本由应用首次启动时通过迁移逻辑执行。

### 8.4 环境变量
```
DATABASE_URL=postgresql://.../rr_portal
DB_SCHEMA=product_library
STORAGE_TYPE=local
STORAGE_LOCAL_PATH=/app/data/files
JWT_SECRET=<同 core>
PORT=3003
```

## 9. 备份策略

上云前本地备份：
- 每日 `pg_dump --schema=product_library` 输出到备份目录
- 每日 `rsync` 备份 `data/files/` 到另一目录或外部盘
- 上 OSS 后：OSS 自身多副本，应用层备份可简化

## 10. 非目标 / YAGNI

以下功能**本期不做**，避免 over-engineering：
- 文件预览（浏览器里看 Excel 内容）——直接下载即可
- 全文搜索 Excel 内容——当前按索引字段筛选足够
- 审批流 / 多人协作锁——权限简单化，负责人唯一
- 手机 App——Web 响应式即可
- 统计报表——未来有需要再加
- 通知/邮件提醒——未来有需要再加

## 11. 未来演进

- **切 OSS**：改 `STORAGE_TYPE=oss` 并填 OSS 凭证
- **增加资料类型**：管理员后台加预置槽位类型
- **跨产品对比**：基于结构化字段做客户/系列维度的统计
- **与 工程啤办单 联动**：若未来需要，通过 RR Portal 核心事件总线打通

## 12. 开放问题

无（brainstorming 期间已全部确认）。
