-- 来料标签单·头+明细 与 采购物料设置。EF 不迁移·幂等。
-- 来料标签单: 给来料物料(物料资料)打印标签用的单据, 选物料+数量+标签数, 保存审核后可打印。
-- 采购物料设置: 按物料设置采购参数(默认供应商/最小订量/采购损耗率%)。

IF OBJECT_ID(N'[来料标签单]', N'U') IS NULL
CREATE TABLE [来料标签单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_来料标签单] PRIMARY KEY,
    [电脑单号] nvarchar(40) NOT NULL,
    [日期] date NOT NULL,
    [备注一] nvarchar(500) NULL,
    [备注二] nvarchar(500) NULL,
    [操作员] nvarchar(80) NOT NULL,
    [审核] char(1) NOT NULL CONSTRAINT [DF_来料标签单_审核] DEFAULT ('0'),
    [审核人] nvarchar(80) NULL,
    [审核时间] datetime2 NULL,
    [创建时间] datetime2 NOT NULL CONSTRAINT [DF_来料标签单_创建时间] DEFAULT (SYSDATETIME()),
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_来料标签单_更新时间] DEFAULT (SYSDATETIME()),
    CONSTRAINT [UQ_来料标签单_电脑单号] UNIQUE ([电脑单号]),
    CONSTRAINT [CK_来料标签单_审核] CHECK ([审核] IN ('0', '1'))
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_来料标签单_日期_ID' AND object_id = OBJECT_ID(N'[来料标签单]'))
CREATE INDEX [IX_来料标签单_日期_ID] ON [来料标签单]([日期], [ID]);

IF OBJECT_ID(N'[来料标签明细]', N'U') IS NULL
CREATE TABLE [来料标签明细] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_来料标签明细] PRIMARY KEY,
    [标签单ID] bigint NOT NULL,
    [行号] int NOT NULL,
    [物料编号] nvarchar(80) NOT NULL,
    [物料名称] nvarchar(240) NULL,
    [规格] nvarchar(240) NULL,
    [颜色] nvarchar(80) NULL,
    [单位] nvarchar(40) NULL,
    [数量] decimal(18,4) NOT NULL,
    [标签数] int NOT NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [FK_来料标签明细_标签单]
        FOREIGN KEY ([标签单ID]) REFERENCES [来料标签单]([ID]) ON DELETE CASCADE,
    CONSTRAINT [UQ_来料标签明细_标签单_行号] UNIQUE ([标签单ID], [行号]),
    CONSTRAINT [CK_来料标签明细_数量] CHECK ([数量] >= 0),
    CONSTRAINT [CK_来料标签明细_标签数] CHECK ([标签数] >= 0)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_来料标签明细_物料编号' AND object_id = OBJECT_ID(N'[来料标签明细]'))
CREATE INDEX [IX_来料标签明细_物料编号] ON [来料标签明细]([物料编号]);

-- 采购物料设置: 一个物料一行, 物料编号唯一。
IF OBJECT_ID(N'[采购物料设置]', N'U') IS NULL
CREATE TABLE [采购物料设置] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_采购物料设置] PRIMARY KEY,
    [物料编号] nvarchar(80) NOT NULL,
    [默认供应商] nvarchar(160) NULL,
    [最小订量] decimal(18,4) NULL,
    [采购损耗率] decimal(9,4) NULL,
    [备注] nvarchar(500) NULL,
    [操作员] nvarchar(80) NULL,
    [创建时间] datetime2 NOT NULL CONSTRAINT [DF_采购物料设置_创建时间] DEFAULT (SYSDATETIME()),
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_采购物料设置_更新时间] DEFAULT (SYSDATETIME()),
    CONSTRAINT [UQ_采购物料设置_物料编号] UNIQUE ([物料编号]),
    CONSTRAINT [CK_采购物料设置_最小订量] CHECK ([最小订量] IS NULL OR [最小订量] >= 0),
    CONSTRAINT [CK_采购物料设置_采购损耗率] CHECK ([采购损耗率] IS NULL OR ([采购损耗率] >= 0 AND [采购损耗率] <= 100))
);
