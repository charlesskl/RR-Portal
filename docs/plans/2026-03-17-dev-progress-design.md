# 新产品开发进度表系统 — 设计文档

**日期**: 2026-03-17
**插件名**: 新产品开发进度表（目录名 `plugins/新产品开发进度表/`）
**类型**: Standalone (Node.js/Express)
**部门**: Engineering

---

## 1. 背景与目标

### 现状
- 9位主管各自维护Excel进度表（如"清溪新产品开发进度表-段新辉"），按车间分sheet
- 每周需要人工汇总统计各车间、各客户的项目进度
- 数据分散在不同文件中，无法实时查看全局状态

### 目标
- 将Excel进度表数字化，所有主管在同一系统录入和更新项目排期
- 支持按车间、客户、主管维度自动汇总
- 减少每周人工统计工作量
- 支持Excel导入（迁移历史数据）和导出

---

## 2. 核心需求

| 需求 | 说明 |
|------|------|
| 无需登录 | 所有人打开即可查看和编辑 |
| 项目管理 | 增删改产品项目，支持行内编辑 |
| 产品图片 | 支持上传产品图片，列表显示缩略图 |
| 固定阶段排期 | 开发时间→FS→EP→FEP→PP→塑胶BOM→采购BOM→PO1走货 |
| 进度标识 | 颜色区分：灰(未开始)、黄(进行中)、绿(已完成)、红(延期) |
| 多维汇总 | 按车间、客户、主管、整体看板汇总统计 |
| Excel导入 | 上传现有Excel，解析预览后确认导入 |
| Excel导出 | 按筛选条件导出Excel |
| 车间可配置 | 初始：兴信A、兴信B、华登，可动态增删 |

---

## 3. 数据模型

存储于 `data/data.json`：

```json
{
  "workshops": ["兴信A", "兴信B", "华登"],
  "customers": ["ZURU", "JAZWARES", "Moose", "TOMY", "Tigerhead", "Zanzoon(嘉苏)", "AZAD", "Brybelly +Entertoymen", "Lifelines", "ToyMonster", "Cepia", "Tikino", "Sky Castle", "Masterkidz", "John Adams", "智海鑫", "PWP(多美）", "CareFocus"],
  "supervisors": ["易东存", "段新辉", "蒙海欢", "唐海林", "万志勇", "章发东", "王玉国", "甘勇辉", "刘际维"],
  "projects": [
    {
      "id": "uuid-v4",
      "workshop": "兴信A",
      "supervisor": "段新辉",
      "engineer": "关芬乐",
      "customer": "ZURU",
      "product_name": "77858魔法烹饪厨房套装",
      "product_image": "uploads/xxx.jpg",
      "mold_sets": "32套新模",
      "age_grade": "3+",
      "estimated_qty": "500K",
      "unit_price_usd": 9.25,
      "tax_rebate": 1.064,
      "schedule": {
        "dev_start": "2025-07-15",
        "fs": "2025-10-10",
        "ep": "EP1:2025/10/28\nEP2:2025/11/20",
        "fep": "2026-01-05",
        "pp": "PP1:2026/1/16\nPP2:2026/2/27",
        "bom_plastic": "2026-02-10",
        "bom_purchase": "2026-02-10",
        "po1_date": "2026-03-27",
        "po1_qty": "2442pcs\n1L版本"
      },
      "outsource_hunan": "是",
      "remarks": "1.彩盒已签办...",
      "created_at": "2026-03-17T00:00:00Z",
      "updated_at": "2026-03-17T00:00:00Z"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string (UUID) | 唯一标识 |
| workshop | string | 厂区/车间 |
| supervisor | string | 负责主管 |
| engineer | string | 跟进工程师 |
| customer | string | 客户 |
| product_name | string | 产品名称 |
| product_image | string/null | 图片路径 |
| mold_sets | string | 工模套数 |
| age_grade | string | 年龄等级 |
| estimated_qty | string | 预计总数量 |
| unit_price_usd | number/null | 货价(USD) |
| tax_rebate | number/null | 退税码点 |
| schedule.dev_start | string/null | 开发时间 |
| schedule.fs | string/null | FS |
| schedule.ep | string/null | EP（可多轮，自由文本） |
| schedule.fep | string/null | FEP |
| schedule.pp | string/null | PP（可多轮，自由文本） |
| schedule.bom_plastic | string/null | 塑胶物料BOM完成期 |
| schedule.bom_purchase | string/null | 采购物料BOM完成期 |
| schedule.po1_date | string/null | PO1走货日期 |
| schedule.po1_qty | string/null | PO1走货数量 |
| outsource_hunan | string | 是否外发湖南 |
| remarks | string | 备注 |
| created_at | string (ISO) | 创建时间 |
| updated_at | string (ISO) | 更新时间 |

---

## 4. 页面设计

### 4.1 主页 — 项目列表（index.html）

- 表格展示所有项目，默认按车间分组显示
- 顶部筛选栏：车间下拉、客户下拉、主管下拉、关键词搜索
- 各阶段用颜色标识进度状态
- 点击单元格行内编辑
- 操作按钮：添加项目、删除项目、上传图片
- 产品图片显示为缩略图

### 4.2 汇总统计页（stats.html）

- **按车间汇总**：每个车间项目数、各阶段分布柱状图
- **按客户汇总**：每个客户项目数、进度状态饼图
- **按主管汇总**：每个组项目数、完成率
- **整体看板**：延期项目红色高亮、即将到期（7天内）橙色提醒

### 4.3 设置页（settings.html）

- 车间列表管理（增删）
- 客户列表管理（增删）
- 主管列表管理（增删）

### 4.4 导入导出

- **导入**：主页上传按钮 → 选择Excel文件 → 前端用xlsx.js解析 → 预览表格 → 确认后POST到后端
- **导出**：主页导出按钮 → 按当前筛选条件导出Excel

---

## 5. 进度标识逻辑

阶段顺序定义：`dev_start → fs → ep → fep → pp → bom_plastic → bom_purchase → po1_date`

对每个阶段字段，根据日期判断状态：

| 状态 | 颜色 | 判定规则 |
|------|------|------|
| 未开始 | 灰色 | 本阶段日期为空，且前一阶段也为空或未到期 |
| 进行中 | 黄色 | 前一阶段日期已过（或为首阶段），本阶段日期为空或日期未到 |
| 已完成 | 绿色 | 本阶段日期已填且日期 ≤ 今天 |
| 延期 | 红色 | 本阶段日期已填且日期 < 今天，但下一阶段日期仍为空（说明卡在这一步）；最后阶段(po1_date)已过期直接标红 |

### EP/PP 多轮日期解析规则

EP、PP 字段为自由文本（如 `"EP1:2025/10/28\nEP2:2025/11/20"`），解析逻辑：
1. 用正则 `/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g` 提取所有日期
2. 取最后一个匹配的日期作为该阶段的判定日期
3. 如果无法提取到任何日期，视为"未开始"（灰色）

---

## 6. 技术架构

### 插件目录结构
```
plugins/新产品开发进度表/
├── Dockerfile              # node:20-alpine
├── package.json
├── server.js               # Express 主服务
├── data/
│   └── data.json           # 持久化数据
├── uploads/                # 产品图片
├── public/
│   ├── index.html          # 主页（项目列表+编辑）
│   ├── stats.html          # 汇总统计页
│   ├── settings.html       # 设置页
│   ├── style.css           # 样式
│   └── app.js              # 前端逻辑
└── 更新新产品开发进度.bat    # 一键更新脚本
```

### API 路由

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/projects | 获取所有项目（支持query筛选: workshop, customer, supervisor） |
| POST | /api/projects | 新增项目 |
| PUT | /api/projects/:id | 更新项目 |
| DELETE | /api/projects/:id | 删除项目 |
| DELETE | /api/projects/batch | 批量删除项目（body: { ids: [...] }） |
| GET | /health | 健康检查 |
| POST | /api/projects/:id/image | 上传产品图片（multer, 限jpg/png/webp, 5MB以内） |
| POST | /api/import | Excel导入（接收解析后的JSON数组） |
| GET | /api/export | Excel导出（支持query筛选: workshop, customer, supervisor） |
| GET | /api/stats | 汇总统计数据 |
| GET | /api/config | 获取配置（车间/客户/主管列表） |
| PUT | /api/config | 更新配置 |

### 并发写入策略

使用写入队列序列化所有写操作（简单的 Promise 队列），确保同一时刻只有一个写操作在执行。每次写入前自动备份 `data.json` 为 `data.json.bak`。

### 初始化策略

服务启动时检查 `data/data.json` 是否存在：
- 不存在：自动创建默认结构（含 workshops、customers、supervisors 初始值，projects 为空数组）
- 已存在：直接加载

### Docker 集成

```yaml
dev-progress:
  build:
    context: ./plugins/新产品开发进度表
    dockerfile: Dockerfile
  ports:
    - "3003:3000"
  volumes:
    - "./plugins/新产品开发进度表/data:/app/data"
    - "./plugins/新产品开发进度表/uploads:/app/uploads"
  environment:
    - PORT=3000
    - DATA_PATH=/app/data
    - APP_PREFIX=/dev-progress
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
    interval: 30s
    timeout: 5s
    start_period: 10s
    retries: 3
  networks:
    - platform-net
```

### Nginx 代理

```nginx
upstream dev-progress {
    server dev-progress:3000;
}

location /dev-progress/ {
    proxy_pass http://dev-progress/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Script-Name /dev-progress;
    client_max_body_size 10M;  # 图片上传
}
```

### 前端技术

- HTML + Bootstrap 5（本地vendor文件，跟其他插件一致）
- xlsx.js 处理前端Excel解析
- 无框架，原生JS，保持与啤办单风格统一
- 前端请求使用相对路径（如 `./api/projects`），nginx 剥离 `/dev-progress/` 前缀后转发

### 前端JS按页面拆分

- `projects.js` — 主页项目列表逻辑
- `stats.js` — 汇总统计页逻辑
- `settings.js` — 设置页逻辑

---

## 7. 依赖

```json
{
  "dependencies": {
    "express": "^4.18",
    "multer": "^1.4",
    "uuid": "^9.0",
    "xlsx": "^0.18"
  }
}
```

---

## 8. 不包含的功能

- 用户登录/权限控制
- 操作日志/审计追踪
- 通知/邮件提醒
