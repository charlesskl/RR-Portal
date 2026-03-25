# 工程资料生成器 — 设计文档

**日期：** 2026-03-25
**状态：** 已确认
**插件名：** 工程资料生成器
**类型：** Standalone (Node.js)
**部门：** Engineering

---

## 1. 背景与痛点

华登/兴信工厂有 20-30 名工程师，同时跟进 100+ 款产品。每款产品需要制作一套工程资料（5份Excel文档），当前流程是**复制上一个类似产品的Excel模板，手动修改数据**。

**痛点：**
- 每款产品花约 **1天** 做资料
- 5份文档之间大量数据重复（产品编号、客户名、数量、零件信息）
- 复制旧文档容易**漏改、改错**
- 数据分散在各工程师的本地文件里，无法集中查询

## 2. 目标

做一个Web系统，工程师填一次产品数据，**一键生成全套5份Excel文档**。输出的Excel格式与现有模板一致，下游部门无感知。

## 3. 需要生成的5份文档

| 文档名 | 文件编号 | 内容 |
|--------|---------|------|
| **排模表** | HSQR0064 | 所有零件的模具、材料、颜色、重量、机型、模腔数等 |
| **外箱资料** | — | 产品/包装/内箱/外箱的尺寸和重量，含照片页 |
| **外购清单** | HSQR0063 | 彩盒、吸塑、辅料、纸箱等外购件明细 |
| **生产注意事项** | HSQR0076 | 产品介绍、功能玩法、测试要求、各部门注意点 |
| **作业指导书** | — | 每个工位的装配SOP（工序、零件、步骤、工具、注意事项） |

## 4. 厂区差异

| 厂区 | 公司抬头 | Logo |
|------|---------|------|
| 华登 | 东莞华登塑胶制品有限公司 | huadeng.png |
| 兴信 | 东莞兴信塑胶制品有限公司 | xingxin.png |

生成Excel时根据所选厂区自动切换抬头和Logo，其他格式不变。

## 5. 系统架构

### 5.1 定位

RR Portal 独立插件（Standalone Node.js），插件文件夹：`plugins/工程资料生成器/`

### 5.2 技术栈

- **后端：** Node.js + Express
- **前端：** Bootstrap 5 + 原生JS
- **Excel生成：** exceljs（支持样式、合并单元格、多Sheet、插入图片）
- **ZIP打包：** archiver
- **数据存储：** JSON文件 + bind mount

## 6. 页面设计

### 6.1 产品列表页（index.html）

- 搜索框：按产品编号/名称/客户搜索
- 筛选：按工程师筛选
- 操作按钮：「新建产品」「从已有产品复制」
- 表格列：产品编号、产品名称、客户、工程师、创建日期、操作（编辑 | 生成Excel | 删除）
- 「生成Excel」→ 下载ZIP包含全套5份文档

### 6.2 产品编辑页（product.html）

6个Tab标签页：

**Tab 1 — 基本信息**
- 厂区（华登/兴信）
- 产品编号、产品名称、客户名称
- 订单数量、年龄分组
- 工程师姓名、编制日期

**Tab 2 — 零件清单**（→ 排模表）
- 可增删行的表格
- 字段：模具编号、模具名称、零件编号、物料名称、材料、海关备案料件名称、颜色、色粉编号、加工内容（喷/印）、水口比率、混水口比例、整啤毛重(g)、整啤净重(g)、单净重(g)、整啤模腔数、出模数、套数、用量、订单需求数、机型、模架尺寸、备注

**Tab 3 — 外购件**（→ 外购清单）
- 分类录入：彩盒、吸塑、辅料、纸箱
- 字段：类别、物料名称、物料编号、规格、材料、海关备案料件名称、颜色、用量、订单需求数、单重(g)、供应商、表面处理、用途、备注

**Tab 4 — 尺寸重量**（→ 外箱资料）
- 装箱方式、内箱材质、外箱材质
- 产品光身：阶段、长/宽/高(cm)、重量(kg)
- 包装：阶段、长/宽/高(含J钩)/高(不含J钩)(cm)、毛重(kg)
- PDQ/展示盒资料（可选）
- 内箱：订箱尺寸（长/宽/高/净重/毛重）+ 量箱尺寸（长/宽/高/净重/毛重）
- 外箱：订箱尺寸（长/宽/高/净重/毛重）+ 量箱尺寸（长/宽/高/净重/毛重）

**Tab 5 — 生产注意事项**（→ 生产注意事项）
- 产品介绍（多行文本）
- 功能玩法描述（多行文本）
- 测试要求（多行文本）
- 啤塑注意事项（多行文本）
- 装配/贴水纸注意事项（多行文本）
- 包装注意事项（多行文本）

**Tab 6 — 作业指导书**（→ 作业指导书）
- 可增删工序
- 每个工序：工序编号、工序名称、单工位操作时间
- 零件列表：名称/材料规格/用量
- 作业内容：多个步骤
- 作业工具列表
- 注意事项列表

### 6.3 「从已有产品复制」功能

弹窗选择已有产品 → 复制全部数据到新产品 → 自动清空产品编号供工程师填写新的 → 工程师只需修改差异部分。

## 7. 数据模型

### 7.1 存储结构

每个产品单独一个JSON文件，避免多人同时编辑时的写入冲突：

```
data/
├── config.json              # 厂区、工程师、供应商配置
├── index.json               # 产品索引（id, product_number, product_name, client_name, engineer, factory, created_at, updated_at）
└── products/
    ├── {uuid-1}.json        # 单个产品完整数据
    ├── {uuid-2}.json
    └── ...
```

写入时自动创建 `.bak` 备份文件。

### 7.2 产品数据（data/products/{id}.json）

```json
{
      "id": "uuid",
      "factory": "华登",
      "product_number": "T02428",
      "product_name": "9.5寸暴力熊",
      "client_name": "Toy Monster",
      "order_qty": 20000,
      "age_grade": "4+",
      "engineer": "胡帆",
      "created_at": "2026-03-25",
      "updated_at": "2026-03-25",

      "parts": [
        {
          "mold_id": "T02428-01",
          "mold_name": "暴力熊-头",
          "part_number": "M01-00-01",
          "part_name": "涂鸦熊-头",
          "material": "PVC 90度（本白）",
          "customs_name": "塑胶粒（PVC）",
          "color": "白色/WhiteC",
          "pigment_no": "57640",
          "process": "喷/印",
          "runner_ratio": null,
          "mixed_ratio": null,
          "gross_weight_g": 105.5,
          "net_weight_g": 105.5,
          "single_net_weight_g": 105.5,
          "cavities": 1,
          "output_per_shot": 1,
          "sets": 1,
          "usage_ratio": "1/4",
          "order_qty": 5000,
          "machine_type": null,
          "mold_size": null,
          "mold_count": "32个搪胶模",
          "notes": "移印工艺",
          "group": "涂鸦公仔"
        }
      ],

      "purchases": [
        {
          "category": "彩盒",
          "name": "T02428-彩盒（涂鸦公仔）",
          "part_number": null,
          "spec": "210*120*290MM",
          "material": "300g灰卡+黑坑+4C+局部UV+烫金+胶片",
          "customs_name": "咭纸",
          "color": "4C+UV",
          "usage_ratio": "1/4",
          "order_qty": 5000,
          "unit_weight_g": 39.5,
          "supplier": "艾美斯",
          "surface_treatment": "/",
          "purpose": "包装",
          "notes": null
        }
      ],

      "dimensions": {
        "packing_method": "1pcs产品入彩盒，8个彩盒入外箱",
        "inner_box_material": null,
        "outer_box_material": null,
        "product": { "stage": "PP", "width": 14.88, "depth": 9.72, "height": 24.0, "weight_kg": null },
        "package": { "stage": "PP", "width": 21.5, "depth": 11.8, "height_with_hook": null, "height_no_hook": 28.8, "gross_weight_kg": 0.6 },
        "display": { "width": null, "depth": null, "closed_height": null, "open_height": null, "total_weight_kg": null },
        "inner_carton_order": { "width": null, "depth": null, "height": null, "nw_kg": null, "gw_kg": null },
        "inner_carton_measure": { "width": null, "depth": null, "height": null, "nw_kg": null, "gw_kg": null },
        "outer_carton_order": { "width": 50.5, "depth": 43.5, "height": 30.8, "nw_kg": null, "gw_kg": null },
        "outer_carton_measure": { "width": 51.0, "depth": 44.5, "height": 32.5, "nw_kg": 4.77, "gw_kg": 5.5 }
      },

      "production_notes": {
        "product_intro": "这是一款搪胶摆件产品，产品四款公仔组成...",
        "function_desc": "产品为摆件，功能简单只需手脚关节可以自由旋转...",
        "test_requirements": "产品需符合常规ASTM F963,EN71美欧安规标准；\n产品喷油需过界油，粘油，长期老化掉油等测试",
        "injection_notes": "啤件颜色对照工程签办，不能有色差夹水纹、缩水等啤塑不良...",
        "assembly_notes": "贴水贴纸，需要24小时才能干透...",
        "packaging_notes": "检查彩盒、吸塑、外观是否有脏污..."
      },

      "work_instructions": [
        {
          "seq": 1,
          "name": "检查外观",
          "cycle_time": "9S",
          "parts_used": [
            { "name": "身体", "material": null, "qty": null }
          ],
          "steps": [
            "检查暴力熊身体外观有无脏污、掉漆、擦花等现象",
            "如有脏污用水擦拭干净，如擦不干净放入次品区",
            "如有掉漆、擦花等严重影响外观现象，放入次品区"
          ],
          "tools": ["布条", "清水", "手套"],
          "cautions": []
        }
      ]
    }
}
```

### 7.3 配置数据（data/config.json）

```json
{
  "factories": [
    { "name": "华登", "full_name": "东莞华登塑胶制品有限公司", "logo": "huadeng.png" },
    { "name": "兴信", "full_name": "东莞兴信塑胶制品有限公司", "logo": "xingxin.png" }
  ],
  "engineers": [],
  "suppliers": []
}
```

### 7.4 数据验证

必填字段：`factory`, `product_number`, `product_name`。数值字段（重量、尺寸）必须是 number 或 null。服务端使用验证中间件，拒绝畸形数据。

## 8. API设计

```
GET    /api/products                       # 产品列表（支持 ?search=&engineer= 筛选）
GET    /api/products/:id                   # 获取单个产品完整数据
POST   /api/products                       # 新建产品
PUT    /api/products/:id                   # 更新产品
DELETE /api/products/:id                   # 删除产品
POST   /api/products/:id/copy              # 从已有产品复制（返回新产品）
POST   /api/products/:id/generate          # 生成全套Excel（返回ZIP下载）
POST   /api/products/:id/generate/:type   # 生成单份（mold|carton|purchase|notes|sop）
GET    /api/config                         # 获取配置
PUT    /api/config                         # 更新配置
GET    /health                             # 健康检查
```

## 9. Excel生成规范

### 9.1 输出文件

```
{产品编号}_{产品名称}_工程资料.zip
├── {产品编号} {产品名称}排模表.xlsx
├── {产品编号} {产品名称}外箱资料.xlsx
├── {产品编号} {产品名称}外购清单.xlsx
├── {产品编号} {产品名称}生产注意事项.xlsx
└── {产品编号} {产品名称}作业指导书.xlsx
```

### 9.2 模板还原要求

- 公司抬头：居中合并单元格，根据厂区切换
- Logo：根据厂区插入对应图片
- 文件编号/版本号：保持原有编号（HSQR0064等）
- 表头行样式：字体、背景色、边框、列宽精确还原
- 签名栏：编制/审核/批准/日期底部保留
- 排模表支持多Sheet（按零件的 `group` 字段分组，如"涂鸦公仔"、"格力奇公仔"各一个Sheet）

### 9.3 生成模块

```
generators/
├── mold-table.js         # 排模表生成
├── carton-spec.js        # 外箱资料生成
├── purchase-list.js      # 外购清单生成
├── production-notes.js   # 生产注意事项生成
└── work-instructions.js  # 作业指导书生成
```

每个模块导出一个 `async generate(product, factoryConfig)` 函数，返回 ExcelJS Workbook 对象。

## 10. 部署

### 10.1 目录结构

```
plugins/工程资料生成器/
├── server.js
├── package.json
├── Dockerfile.node
├── generators/
│   ├── mold-table.js
│   ├── carton-spec.js
│   ├── purchase-list.js
│   ├── production-notes.js
│   └── work-instructions.js
├── public/
│   ├── index.html
│   ├── product.html
│   ├── style.css
│   └── utils.js
├── assets/
│   ├── huadeng.png
│   └── xingxin.png
├── .env.example
└── data/
    ├── config.json
    ├── index.json
    └── products/
```

### 10.2 docker-compose

```yaml
eng-doc-generator:
  build:
    context: .
    dockerfile: plugins/工程资料生成器/Dockerfile.node
  env_file: plugins/工程资料生成器/.env
  volumes:
    - "./plugins/工程资料生成器/data:/app/data"
  restart: unless-stopped
  networks:
    - platform-net
```

### 10.3 Nginx

```nginx
upstream eng-doc-generator { server eng-doc-generator:3000; }

location /eng-docs/api/ { proxy_pass http://eng-doc-generator/api/; }
location /eng-docs/     { proxy_pass http://eng-doc-generator/; }
```

### 10.4 依赖

```json
{
  "express": "^4.18",
  "exceljs": "^4.4",
  "archiver": "^6.0",
  "uuid": "^9.0",
  "multer": "^1.4"
}
```

## 11. 预期效果

| 指标 | 当前 | 使用后 |
|------|------|--------|
| 做一套资料耗时 | ~1天 | ~30分钟 |
| 漏改/改错率 | 高 | 几乎为零 |
| 数据复用 | 复制Excel文件 | 系统内一键复制 |
| 数据查询 | 翻找本地文件 | 搜索/筛选 |
