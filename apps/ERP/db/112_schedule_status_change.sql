-- 排期状态变更审核(db/111 手工 CRUD 的配套):普通用户改状态 → 待经理审核,通过后生效。幂等(可重跑)。
-- 审核口径与三级流转一致:人事档案.职称='经理' 或 admin(PurchaseApprovalChainService)。
-- Excel 导入/出货领料联动改状态不走本表(权威源/系统动作)。
IF OBJECT_ID(N'生产排期状态变更', N'U') IS NULL
    CREATE TABLE [生产排期状态变更](
        [ID] bigint IDENTITY(1,1) PRIMARY KEY,
        [排期ID] bigint NOT NULL,
        [原状态] nvarchar(10) NULL,
        [新状态] nvarchar(10) NOT NULL,
        [审核状态] nvarchar(10) NOT NULL CONSTRAINT [DF_生产排期状态变更_审核状态] DEFAULT(N'待审核'), -- 待审核/已通过/已驳回
        [申请人] nvarchar(30) NULL,
        [申请日期] datetime NOT NULL CONSTRAINT [DF_生产排期状态变更_申请日期] DEFAULT(GETDATE()),
        [审核人] nvarchar(30) NULL,
        [审核日期] datetime NULL,
        [审核备注] nvarchar(200) NULL
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产排期状态变更_审核状态')
    CREATE INDEX [IX_生产排期状态变更_审核状态] ON [生产排期状态变更]([审核状态]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产排期状态变更_排期ID')
    CREATE INDEX [IX_生产排期状态变更_排期ID] ON [生产排期状态变更]([排期ID]);
