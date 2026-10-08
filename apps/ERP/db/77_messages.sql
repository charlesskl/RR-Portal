-- 消息后台：系统消息表。领料单三级流转产生消息(装配部主管→经理→仓管)，接收人在消息中心查看并审核。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name=N'消息')
BEGIN
    CREATE TABLE [消息] (
        [ID] bigint IDENTITY(1,1) PRIMARY KEY,
        [接收人] nvarchar(40) NOT NULL,          -- 账号(用户)
        [类型] nvarchar(20) NOT NULL,            -- 领料审批
        [单号] nvarchar(20) NULL,                -- 关联单据号(领料单)
        [标题] nvarchar(200) NOT NULL,
        [内容] nvarchar(500) NULL,
        [已读] nvarchar(4) NOT NULL DEFAULT '0',
        [创建时间] datetime NOT NULL DEFAULT SYSDATETIME(),
        [读取时间] datetime NULL
    );
    CREATE INDEX IX_消息_接收人 ON [消息]([接收人],[已读]);
END
