/* =====================================================================
   车缝核价对比系统 · 数据库建表脚本 rebuild_schema.sql
   ---------------------------------------------------------------------
   目标数据库 : StitchCostPro (SQL Server)
   依据       : docs/数据库设计.md (16 张表 / 6 大数据区)
   全局约定   :
     - 金额/工价/价格/码点 一律 decimal，严禁 float（杜绝算钱误差）
     - 主数据表预留 ext_main_id（对接主系统，默认 NULL）
     - 业务表带 dept_id（部门/工厂，为外地复制预留）
     - 价格/码点类「只增不改、留版本、带生效日期」
     - 通用审计字段：created_by/created_at/updated_by/updated_at
   说明       : 本脚本可重复执行（幂等）——先删后建，方便开发期反复重建。
   编制日期   : 2026-06-13
   ===================================================================== */

/* ---------- 0. 创建数据库（若不存在） ---------- */
IF DB_ID(N'StitchCostPro') IS NULL
BEGIN
    CREATE DATABASE [StitchCostPro];
END
GO

USE [StitchCostPro];
GO

/* =====================================================================
   先删除已存在的表（按外键依赖的「反向顺序」删，避免被引用而删不掉）
   —— 开发期反复重建用；表里有数据时执行会清空，慎用于生产。
   ===================================================================== */
IF OBJECT_ID(N'dbo.supplier_quality_stat', N'U') IS NOT NULL DROP TABLE dbo.supplier_quality_stat;
IF OBJECT_ID(N'dbo.quality_inspection',     N'U') IS NOT NULL DROP TABLE dbo.quality_inspection;
IF OBJECT_ID(N'dbo.comparison_snapshot',    N'U') IS NOT NULL DROP TABLE dbo.comparison_snapshot;
IF OBJECT_ID(N'dbo.outsource_assignment',   N'U') IS NOT NULL DROP TABLE dbo.outsource_assignment;
IF OBJECT_ID(N'dbo.price_markup_log',       N'U') IS NOT NULL DROP TABLE dbo.price_markup_log;
IF OBJECT_ID(N'dbo.compliance_check',       N'U') IS NOT NULL DROP TABLE dbo.compliance_check;
IF OBJECT_ID(N'dbo.outsource_price',        N'U') IS NOT NULL DROP TABLE dbo.outsource_price;
IF OBJECT_ID(N'dbo.markup_rate',            N'U') IS NOT NULL DROP TABLE dbo.markup_rate;
IF OBJECT_ID(N'dbo.process_timing',         N'U') IS NOT NULL DROP TABLE dbo.process_timing;
IF OBJECT_ID(N'dbo.supplier',               N'U') IS NOT NULL DROP TABLE dbo.supplier;
IF OBJECT_ID(N'dbo.craft_rate',             N'U') IS NOT NULL DROP TABLE dbo.craft_rate;
IF OBJECT_ID(N'dbo.process_item',           N'U') IS NOT NULL DROP TABLE dbo.process_item;
IF OBJECT_ID(N'dbo.process_category',       N'U') IS NOT NULL DROP TABLE dbo.process_category;
IF OBJECT_ID(N'dbo.product',                N'U') IS NOT NULL DROP TABLE dbo.product;
IF OBJECT_ID(N'dbo.sys_user',               N'U') IS NOT NULL DROP TABLE dbo.sys_user;
IF OBJECT_ID(N'dbo.dept',                   N'U') IS NOT NULL DROP TABLE dbo.dept;
GO

/* =====================================================================
   ① 系统 / 权限区
   ===================================================================== */

/* 部门 / 工厂：本厂、外地车缝部等。所有业务数据都挂在某个部门下 */
CREATE TABLE dbo.dept (
    dept_id      INT IDENTITY(1,1) NOT NULL,          -- 主键，自增
    dept_code    NVARCHAR(20)  NOT NULL,              -- 部门编码（HQ 本厂 / WD 外地）
    dept_name    NVARCHAR(50)  NOT NULL,              -- 部门名称
    is_active    BIT           NOT NULL CONSTRAINT DF_dept_active DEFAULT(1),  -- 是否启用
    ext_main_id  NVARCHAR(50)  NULL,                  -- 预留：主系统对应部门 ID
    created_by   INT           NULL,
    created_at   DATETIME2     NOT NULL CONSTRAINT DF_dept_created DEFAULT(SYSDATETIME()),
    updated_by   INT           NULL,
    updated_at   DATETIME2     NULL,
    CONSTRAINT PK_dept PRIMARY KEY (dept_id),
    CONSTRAINT UQ_dept_code UNIQUE (dept_code)
);
GO

/* 用户：能登录系统的人（约 20 人） */
CREATE TABLE dbo.sys_user (
    user_id       INT IDENTITY(1,1) NOT NULL,
    username      NVARCHAR(50)  NOT NULL,             -- 登录账号
    password_hash NVARCHAR(200) NOT NULL,             -- bcrypt 加密后的密码（绝不存明文）
    display_name  NVARCHAR(50)  NOT NULL,             -- 显示姓名
    dept_id       INT           NOT NULL,             -- 所属部门
    userbqrpower  NVARCHAR(9)   NULL,                 -- 9 位权限串（与主系统同款格式）
    is_active     BIT           NOT NULL CONSTRAINT DF_user_active DEFAULT(1),
    ext_main_id   NVARCHAR(50)  NULL,                 -- 预留：主系统对应用户 ID
    created_by    INT           NULL,
    created_at    DATETIME2     NOT NULL CONSTRAINT DF_user_created DEFAULT(SYSDATETIME()),
    updated_by    INT           NULL,
    updated_at    DATETIME2     NULL,
    CONSTRAINT PK_sys_user PRIMARY KEY (user_id),
    CONSTRAINT UQ_user_name UNIQUE (username),
    CONSTRAINT FK_user_dept FOREIGN KEY (dept_id) REFERENCES dbo.dept(dept_id)
);
GO

/* =====================================================================
   ② 基础档案区
   ===================================================================== */

/* 货号 / 品名档案：每一个被核价的产品。主界面每一行的起点 */
CREATE TABLE dbo.product (
    product_id   INT IDENTITY(1,1) NOT NULL,
    product_code NVARCHAR(50)  NOT NULL,              -- 货号（如 15783）
    product_name NVARCHAR(100) NOT NULL,             -- 品名（如 开心鸡块）
    spec         NVARCHAR(200) NULL,                 -- 规格 / 备注
    dept_id      INT           NOT NULL,             -- 归属部门
    is_active    BIT           NOT NULL CONSTRAINT DF_product_active DEFAULT(1),
    ext_main_id  NVARCHAR(50)  NULL,                 -- 预留：主系统货号 ID
    created_by   INT           NULL,
    created_at   DATETIME2     NOT NULL CONSTRAINT DF_product_created DEFAULT(SYSDATETIME()),
    updated_by   INT           NULL,
    updated_at   DATETIME2     NULL,
    CONSTRAINT PK_product PRIMARY KEY (product_id),
    CONSTRAINT UQ_product_code UNIQUE (product_code, dept_id),  -- 同部门内货号唯一
    CONSTRAINT FK_product_dept FOREIGN KEY (dept_id) REFERENCES dbo.dept(dept_id)
);
GO

/* 工序大类：裁床/车缝/充棉/手工/包装/电绣 */
CREATE TABLE dbo.process_category (
    category_id   INT IDENTITY(1,1) NOT NULL,
    category_name NVARCHAR(50) NOT NULL,             -- 大类名称
    is_comparable BIT          NOT NULL CONSTRAINT DF_cat_comparable DEFAULT(1),
                                                     -- 是否参与内外对比（既能本厂又能外发=1；纯外发=0）
    sort_order    INT          NOT NULL CONSTRAINT DF_cat_sort DEFAULT(0),  -- 主界面显示顺序
    is_active     BIT          NOT NULL CONSTRAINT DF_cat_active DEFAULT(1),
    created_by    INT          NULL,
    created_at    DATETIME2    NOT NULL CONSTRAINT DF_cat_created DEFAULT(SYSDATETIME()),
    updated_by    INT          NULL,
    updated_at    DATETIME2    NULL,
    CONSTRAINT PK_process_category PRIMARY KEY (category_id),
    CONSTRAINT UQ_category_name UNIQUE (category_name)
);
GO

/* 小工序：某工序大类下的每一道具体工序（打秒挂在这一层） */
CREATE TABLE dbo.process_item (
    item_id     INT IDENTITY(1,1) NOT NULL,
    category_id INT          NOT NULL,               -- 所属工序大类
    item_name   NVARCHAR(100) NOT NULL,             -- 小工序名称（如 丝带折双固定）
    craft_type  NVARCHAR(50) NOT NULL,              -- 工种（车缝/手工缝…）→ 决定用哪个费率
    sort_order  INT          NOT NULL CONSTRAINT DF_item_sort DEFAULT(0),
    is_active   BIT          NOT NULL CONSTRAINT DF_item_active DEFAULT(1),
    created_by  INT          NULL,
    created_at  DATETIME2    NOT NULL CONSTRAINT DF_item_created DEFAULT(SYSDATETIME()),
    updated_by  INT          NULL,
    updated_at  DATETIME2    NULL,
    CONSTRAINT PK_process_item PRIMARY KEY (item_id),
    CONSTRAINT FK_item_category FOREIGN KEY (category_id) REFERENCES dbo.process_category(category_id)
);
GO

/* 工种费率：每工种每小时多少钱（车缝18/手工30）。留版本、带生效日期 */
CREATE TABLE dbo.craft_rate (
    rate_id        INT IDENTITY(1,1) NOT NULL,
    craft_type     NVARCHAR(50)  NOT NULL,           -- 工种名称
    hourly_rate    DECIMAL(10,2) NOT NULL,           -- 每小时费率（如 18.00）
    effective_date DATE          NOT NULL,           -- 生效日期
    dept_id        INT           NOT NULL,           -- 归属部门（不同部门费率可不同）
    is_current     BIT           NOT NULL CONSTRAINT DF_rate_current DEFAULT(1),  -- 是否当前生效版本
    created_by     INT           NULL,
    created_at     DATETIME2     NOT NULL CONSTRAINT DF_rate_created DEFAULT(SYSDATETIME()),
    updated_by     INT           NULL,
    updated_at     DATETIME2     NULL,
    CONSTRAINT PK_craft_rate PRIMARY KEY (rate_id),
    CONSTRAINT FK_rate_dept FOREIGN KEY (dept_id) REFERENCES dbo.dept(dept_id)
);
GO

/* 外发厂 / 供应商档案 */
CREATE TABLE dbo.supplier (
    supplier_id   INT IDENTITY(1,1) NOT NULL,
    supplier_code NVARCHAR(50)  NOT NULL,            -- 供应商编码
    supplier_name NVARCHAR(100) NOT NULL,            -- 供应商名称
    contact       NVARCHAR(200) NULL,               -- 联系方式
    main_process  NVARCHAR(100) NULL,               -- 主营工序（车缝/充棉/手工…）
    dept_id       INT           NOT NULL,            -- 归属部门
    is_active     BIT           NOT NULL CONSTRAINT DF_supplier_active DEFAULT(1),
    ext_main_id   NVARCHAR(50)  NULL,                -- 预留：主系统供应商 ID
    created_by    INT           NULL,
    created_at    DATETIME2     NOT NULL CONSTRAINT DF_supplier_created DEFAULT(SYSDATETIME()),
    updated_by    INT           NULL,
    updated_at    DATETIME2     NULL,
    CONSTRAINT PK_supplier PRIMARY KEY (supplier_id),
    CONSTRAINT UQ_supplier_code UNIQUE (supplier_code, dept_id),
    CONSTRAINT FK_supplier_dept FOREIGN KEY (dept_id) REFERENCES dbo.dept(dept_id)
);
GO

/* =====================================================================
   ③ 内部核价区
   ===================================================================== */

/* 打秒记录：每道小工序测定的标准工时（秒）。留版本，因「保守秒/量大打折」可能调整 */
CREATE TABLE dbo.process_timing (
    timing_id      INT IDENTITY(1,1) NOT NULL,
    product_id     INT           NOT NULL,           -- 哪个货号
    item_id        INT           NOT NULL,           -- 哪道小工序
    seconds        DECIMAL(10,2) NOT NULL,           -- 标准秒数（如 14.00）
    timing_type    NVARCHAR(20)  NOT NULL CONSTRAINT DF_timing_type DEFAULT(N'保守秒'),
                                                     -- 秒类型：保守秒（报价用）/ 实际秒
    effective_date DATE          NOT NULL,           -- 生效日期
    is_current     BIT           NOT NULL CONSTRAINT DF_timing_current DEFAULT(1),
    dept_id        INT           NOT NULL,
    created_by     INT           NULL,
    created_at     DATETIME2     NOT NULL CONSTRAINT DF_timing_created DEFAULT(SYSDATETIME()),
    updated_by     INT           NULL,
    updated_at     DATETIME2     NULL,
    CONSTRAINT PK_process_timing PRIMARY KEY (timing_id),
    CONSTRAINT FK_timing_product FOREIGN KEY (product_id) REFERENCES dbo.product(product_id),
    CONSTRAINT FK_timing_item    FOREIGN KEY (item_id)    REFERENCES dbo.process_item(item_id),
    CONSTRAINT FK_timing_dept    FOREIGN KEY (dept_id)    REFERENCES dbo.dept(dept_id)
);
GO

/* 码点 / 利润汇率点数配置 ★关键：内部/外发码点，会变、可分厂、留版本 */
CREATE TABLE dbo.markup_rate (
    markup_id      INT IDENTITY(1,1) NOT NULL,
    markup_scope   NVARCHAR(10)  NOT NULL,           -- 适用范围：内部 / 外发
    supplier_id    INT           NULL,              -- 外发码点可指定具体外发厂；内部码点为空
    markup_value   DECIMAL(10,4) NOT NULL,           -- 码点值（如 1.1000 = 加 10% 利润）
    effective_date DATE          NOT NULL,           -- 生效日期
    is_current     BIT           NOT NULL CONSTRAINT DF_markup_current DEFAULT(1),
    dept_id        INT           NOT NULL,
    created_by     INT           NULL,
    created_at     DATETIME2     NOT NULL CONSTRAINT DF_markup_created DEFAULT(SYSDATETIME()),
    updated_by     INT           NULL,
    updated_at     DATETIME2     NULL,
    CONSTRAINT PK_markup_rate PRIMARY KEY (markup_id),
    CONSTRAINT CK_markup_scope CHECK (markup_scope IN (N'内部', N'外发')),
    CONSTRAINT FK_markup_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
    CONSTRAINT FK_markup_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* =====================================================================
   ④ 外发价区
   ===================================================================== */

/* 外发报价 ★留版本：各外发厂对某货号某工序的实际报价 */
CREATE TABLE dbo.outsource_price (
    price_id       INT IDENTITY(1,1) NOT NULL,
    product_id     INT           NOT NULL,           -- 哪个货号
    item_id        INT           NOT NULL,           -- 哪道小工序
    supplier_id    INT           NOT NULL,           -- 哪家外发厂
    base_price     DECIMAL(12,4) NOT NULL,           -- 外发报价（不含码点的基数）
    effective_date DATE          NOT NULL,           -- 生效日期
    is_current     BIT           NOT NULL CONSTRAINT DF_oprice_current DEFAULT(1),
    dept_id        INT           NOT NULL,
    created_by     INT           NULL,
    created_at     DATETIME2     NOT NULL CONSTRAINT DF_oprice_created DEFAULT(SYSDATETIME()),
    updated_by     INT           NULL,
    updated_at     DATETIME2     NULL,
    CONSTRAINT PK_outsource_price PRIMARY KEY (price_id),
    CONSTRAINT FK_oprice_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
    CONSTRAINT FK_oprice_item     FOREIGN KEY (item_id)     REFERENCES dbo.process_item(item_id),
    CONSTRAINT FK_oprice_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
    CONSTRAINT FK_oprice_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* 合规判定：外发价 vs 内定价。超价=不合规，强制填原因 */
CREATE TABLE dbo.compliance_check (
    check_id        INT IDENTITY(1,1) NOT NULL,
    product_id      INT           NOT NULL,
    item_id         INT           NOT NULL,
    supplier_id     INT           NOT NULL,
    outsource_price DECIMAL(12,4) NOT NULL,          -- 当时的外发价（含码点）
    internal_price  DECIMAL(12,4) NOT NULL,          -- 当时的内定价基准
    is_compliant    BIT           NOT NULL,          -- 是否合规（外发 ≤ 内定价 = 1）
    over_reason     NVARCHAR(500) NULL,              -- 不合规原因（超价时必填，DB 层 + 应用层双重强制）
    check_date      DATETIME2     NOT NULL CONSTRAINT DF_check_date DEFAULT(SYSDATETIME()),
    dept_id         INT           NOT NULL,
    created_by      INT           NULL,
    created_at      DATETIME2     NOT NULL CONSTRAINT DF_check_created DEFAULT(SYSDATETIME()),
    updated_by      INT           NULL,
    updated_at      DATETIME2     NULL,
    CONSTRAINT PK_compliance_check PRIMARY KEY (check_id),
    -- 超价（不合规）时必须填原因，DB 层兜底，杜绝脏数据
    CONSTRAINT CK_check_over_reason CHECK (is_compliant = 1 OR over_reason IS NOT NULL),
    CONSTRAINT FK_check_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
    CONSTRAINT FK_check_item     FOREIGN KEY (item_id)     REFERENCES dbo.process_item(item_id),
    CONSTRAINT FK_check_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
    CONSTRAINT FK_check_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* 工序提价留痕 ★强制留痕：找不到厂做而上调价格时记录痕迹 */
CREATE TABLE dbo.price_markup_log (
    log_id        INT IDENTITY(1,1) NOT NULL,
    product_id    INT           NOT NULL,
    item_id       INT           NOT NULL,            -- 加在哪道工序
    supplier_id   INT           NULL,               -- 涉及外发厂（可空）
    markup_amount DECIMAL(12,4) NOT NULL,            -- 加了多少钱
    reason        NVARCHAR(500) NOT NULL,            -- 提价原因
    operator_id   INT           NOT NULL,            -- 谁加的
    markup_time   DATETIME2     NOT NULL CONSTRAINT DF_mlog_time DEFAULT(SYSDATETIME()),  -- 何时加的
    dept_id       INT           NOT NULL,
    created_at    DATETIME2     NOT NULL CONSTRAINT DF_mlog_created DEFAULT(SYSDATETIME()),
    CONSTRAINT PK_price_markup_log PRIMARY KEY (log_id),
    CONSTRAINT FK_mlog_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
    CONSTRAINT FK_mlog_item     FOREIGN KEY (item_id)     REFERENCES dbo.process_item(item_id),
    CONSTRAINT FK_mlog_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
    CONSTRAINT FK_mlog_operator FOREIGN KEY (operator_id) REFERENCES dbo.sys_user(user_id),
    CONSTRAINT FK_mlog_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* =====================================================================
   ⑤ 多厂拆分 / 对比区（系统心脏）
   ===================================================================== */

/* 货号工序分发 ★多厂核心：某货号某工序大类指派给哪家外发厂 */
CREATE TABLE dbo.outsource_assignment (
    assign_id   INT IDENTITY(1,1) NOT NULL,
    product_id  INT       NOT NULL,                  -- 货号
    category_id INT       NOT NULL,                  -- 工序大类
    supplier_id INT       NOT NULL,                  -- 指派给哪家外发厂
    is_active   BIT       NOT NULL CONSTRAINT DF_assign_active DEFAULT(1),  -- 是否当前有效分发
    dept_id     INT       NOT NULL,
    created_by  INT       NULL,
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_assign_created DEFAULT(SYSDATETIME()),
    updated_by  INT       NULL,
    updated_at  DATETIME2 NULL,
    CONSTRAINT PK_outsource_assignment PRIMARY KEY (assign_id),
    CONSTRAINT FK_assign_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
    CONSTRAINT FK_assign_category FOREIGN KEY (category_id) REFERENCES dbo.process_category(category_id),
    CONSTRAINT FK_assign_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
    CONSTRAINT FK_assign_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* 对比结果快照 ★老板看的那个数：本厂 vs 外发 vs 利润差 留底 */
CREATE TABLE dbo.comparison_snapshot (
    snapshot_id          INT IDENTITY(1,1) NOT NULL,
    product_id           INT           NOT NULL,     -- 货号
    category_id          INT           NULL,        -- 工序大类（空=整货号汇总行）
    internal_quote       DECIMAL(14,4) NULL,        -- 内部核价（报价，含内部码点）
    internal_actual_cost DECIMAL(14,4) NULL,        -- 本厂实际工价（含社保加班 ×1.72）
    outsource_total      DECIMAL(14,4) NULL,        -- 外发做总成本（多厂汇总后，含外发码点）
    diff_vs_quote        DECIMAL(14,4) NULL,        -- 外发 VS 核价：差额
    diff_vs_actual       DECIMAL(14,4) NULL,        -- 外发 VS 内部：差额
    suggestion           NVARCHAR(20)  NULL,        -- 系统建议：推荐自产 / 推荐外发
    snapshot_date        DATETIME2     NOT NULL CONSTRAINT DF_snap_date DEFAULT(SYSDATETIME()),
    dept_id              INT           NOT NULL,
    created_by           INT           NULL,
    created_at           DATETIME2     NOT NULL CONSTRAINT DF_snap_created DEFAULT(SYSDATETIME()),
    CONSTRAINT PK_comparison_snapshot PRIMARY KEY (snapshot_id),
    CONSTRAINT FK_snap_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
    CONSTRAINT FK_snap_category FOREIGN KEY (category_id) REFERENCES dbo.process_category(category_id),
    CONSTRAINT FK_snap_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* =====================================================================
   ⑥ 质量管理区
   ===================================================================== */

/* 来料质检台账：外发厂交货时的质检记录 */
CREATE TABLE dbo.quality_inspection (
    inspection_id   INT IDENTITY(1,1) NOT NULL,
    supplier_id     INT           NOT NULL,          -- 哪家外发厂
    product_id      INT           NULL,             -- 哪个货号（可空）
    receive_qty     DECIMAL(12,2) NULL,             -- 收货数量
    sample_qty      DECIMAL(12,2) NULL,             -- 抽检数量
    defect_qty      DECIMAL(12,2) NULL,             -- 不良数量
    defect_process  NVARCHAR(100) NULL,             -- 不良工序
    qc_score        DECIMAL(5,2)  NULL,             -- QC 评分
    inspect_date    DATE          NOT NULL,          -- 质检日期
    dept_id         INT           NOT NULL,
    created_by      INT           NULL,
    created_at      DATETIME2     NOT NULL CONSTRAINT DF_insp_created DEFAULT(SYSDATETIME()),
    updated_by      INT           NULL,
    updated_at      DATETIME2     NULL,
    CONSTRAINT PK_quality_inspection PRIMARY KEY (inspection_id),
    CONSTRAINT FK_insp_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
    CONSTRAINT FK_insp_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
    CONSTRAINT FK_insp_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* 供应商质量统计：按厂汇总的良率/退货率（由质检台账聚合） */
CREATE TABLE dbo.supplier_quality_stat (
    stat_id       INT IDENTITY(1,1) NOT NULL,
    supplier_id   INT           NOT NULL,
    period        NVARCHAR(20)  NOT NULL,            -- 统计周期（如 2026-06）
    total_qty     DECIMAL(14,2) NULL,               -- 总收货量
    defect_rate   DECIMAL(7,4)  NULL,               -- 不良率
    return_rate   DECIMAL(7,4)  NULL,               -- 退货率
    avg_qc_score  DECIMAL(5,2)  NULL,               -- 平均 QC 评分
    dept_id       INT           NOT NULL,
    created_by    INT           NULL,
    created_at    DATETIME2     NOT NULL CONSTRAINT DF_stat_created DEFAULT(SYSDATETIME()),
    updated_by    INT           NULL,
    updated_at    DATETIME2     NULL,
    CONSTRAINT PK_supplier_quality_stat PRIMARY KEY (stat_id),
    CONSTRAINT FK_stat_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
    CONSTRAINT FK_stat_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
);
GO

/* =====================================================================
   ⑦ 版本唯一性约束（过滤唯一索引）
   ---------------------------------------------------------------------
   设计文档核心原则：价格/费率/码点/打秒「只增不改、留版本」，算钱时
   必须「取唯一一条当前生效」。用 is_current=1 的过滤唯一索引强制：
   同一业务键下，当前生效版本有且仅有一条，杜绝取价二义性。
   （注：SQL Server 过滤唯一索引中 NULL 视为单一值——
     如 markup_rate 内部码点 supplier_id 为 NULL，恰好每部门只允许一条当前内部码点。）
   ===================================================================== */

-- 工种费率：每部门每工种只允许一条当前版本
CREATE UNIQUE INDEX UX_craft_rate_current
    ON dbo.craft_rate (craft_type, dept_id)
    WHERE is_current = 1;
GO

-- 打秒：每部门每货号每工序每秒类型只允许一条当前版本
CREATE UNIQUE INDEX UX_timing_current
    ON dbo.process_timing (product_id, item_id, timing_type, dept_id)
    WHERE is_current = 1;
GO

-- 码点：每部门每范围每厂（内部为 NULL）只允许一条当前版本
CREATE UNIQUE INDEX UX_markup_current
    ON dbo.markup_rate (markup_scope, supplier_id, dept_id)
    WHERE is_current = 1;
GO

-- 外发报价：每部门每货号每工序每厂只允许一条当前版本
CREATE UNIQUE INDEX UX_oprice_current
    ON dbo.outsource_price (product_id, item_id, supplier_id, dept_id)
    WHERE is_current = 1;
GO

/* =====================================================================
   ⑧ 性能索引（外键列 / 对比主界面热点查询）
   ---------------------------------------------------------------------
   SQL Server 不为外键自动建索引。对比主界面大量按 货号/工序/厂 join，
   这里为高频外键列与查询列补普通非聚集索引。
   ===================================================================== */
CREATE INDEX IX_user_dept            ON dbo.sys_user(dept_id);
CREATE INDEX IX_product_dept         ON dbo.product(dept_id);
CREATE INDEX IX_item_category        ON dbo.process_item(category_id);
CREATE INDEX IX_rate_dept            ON dbo.craft_rate(dept_id);
CREATE INDEX IX_supplier_dept        ON dbo.supplier(dept_id);
CREATE INDEX IX_timing_product       ON dbo.process_timing(product_id, item_id);
CREATE INDEX IX_markup_supplier      ON dbo.markup_rate(supplier_id);
CREATE INDEX IX_oprice_product       ON dbo.outsource_price(product_id, item_id);
CREATE INDEX IX_oprice_supplier      ON dbo.outsource_price(supplier_id);
CREATE INDEX IX_check_product        ON dbo.compliance_check(product_id, item_id, supplier_id);
CREATE INDEX IX_mlog_product         ON dbo.price_markup_log(product_id, item_id);
CREATE INDEX IX_assign_product       ON dbo.outsource_assignment(product_id, category_id);
CREATE INDEX IX_assign_supplier      ON dbo.outsource_assignment(supplier_id);
CREATE INDEX IX_snap_product         ON dbo.comparison_snapshot(product_id, snapshot_date);
CREATE INDEX IX_insp_supplier        ON dbo.quality_inspection(supplier_id, inspect_date);
CREATE INDEX IX_insp_product         ON dbo.quality_inspection(product_id);
CREATE INDEX IX_stat_supplier        ON dbo.supplier_quality_stat(supplier_id, period);
GO

PRINT N'====== StitchCostPro 建表完成：16 张表 + 版本唯一索引 + 性能索引已创建 ======';
GO
