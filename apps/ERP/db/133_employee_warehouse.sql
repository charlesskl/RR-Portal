-- 133: 人事档案加「所属仓库」(仓务/装配录入人员归属哪个仓,供各仓个人库存金额表分派权限用)。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[人事档案]') AND name=N'所属仓库')
    ALTER TABLE [人事档案] ADD [所属仓库] nvarchar(20) NULL;
