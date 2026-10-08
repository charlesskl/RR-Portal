-- 自建数据库建表脚本(净室重建,数据模型借鉴,非原库)
-- 改进:image->varbinary(max), ntext->nvarchar(max), ID 设为自增主键
-- 生成自 schema_full.txt (146 表)

CREATE TABLE [a合同表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [类别编号] nvarchar(20) NULL,
    [合同号] nvarchar(50) NULL,
    [类别] nvarchar(20) NULL
);

CREATE TABLE [a货号表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [类别编号] nvarchar(20) NULL,
    [合同号] nvarchar(50) NULL,
    [货号] nvarchar(50) NULL,
    [合同图片] varbinary(max) NULL,
    [唛头图片] varbinary(max) NULL,
    [布标图片] varbinary(max) NULL,
    [贴纸图片] varbinary(max) NULL
);

CREATE TABLE [b缺勤登记明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [标识号] nvarchar(20) NULL,
    [操作日期] datetime2(0) NULL,
    [操作员] nvarchar(20) NULL,
    [工号] nvarchar(20) NULL,
    [姓名] nvarchar(10) NULL,
    [部门] nvarchar(20) NULL,
    [登记类型] nvarchar(6) NULL,
    [前后段] nvarchar(6) NULL,
    [计算出勤] nvarchar(6) NULL,
    [日期] datetime2(0) NULL,
    [开始时间] nvarchar(30) NULL,
    [结束时间] nvarchar(30) NULL,
    [事由] nvarchar(150) NULL
);

CREATE TABLE [c操作记录] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期时间] datetime NULL,
    [表名] nvarchar(30) NULL,
    [行为] nvarchar(20) NULL,
    [操作员] nvarchar(25) NULL,
    [操作记录] nvarchar(200) NULL,
    [备注] nvarchar(50) NULL
);

CREATE TABLE [netremote] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [word] nvarchar(100) NULL
);

CREATE TABLE [sysfilename] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [name] nvarchar(120) NULL,
    [computer] nvarchar(120) NULL,
    [memo] nvarchar(200) NULL
);

CREATE TABLE [sysfilenet] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [computer] nvarchar(40) NULL,
    [name] nvarchar(40) NULL,
    [status] nvarchar(10) NULL,
    [date] datetime NULL
);

CREATE TABLE [sysfileuser] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [客户] nvarchar(40) NULL,
    [登录状态] nvarchar(10) NULL,
    [用户] nvarchar(40) NULL,
    [密码] nvarchar(60) NULL,
    [上次登录] nvarchar(40) NULL,
    [日期] datetime NULL,
    [计算机名字] nvarchar(40) NULL,
    [IP地址] nvarchar(26) NULL,
    [退出时间] datetime NULL,
    [错密1] nvarchar(50) NULL,
    [错密2] nvarchar(50) NULL,
    [错密3] nvarchar(50) NULL,
    [错密4] nvarchar(50) NULL,
    [错密5] nvarchar(50) NULL
);

CREATE TABLE [userbqrpower] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [类别] nvarchar(2) NULL,
    [用户] nvarchar(30) NULL,
    [名称] nvarchar(40) NULL,
    [菜单] nvarchar(40) NULL,
    [打开] bit NULL,
    [保存] bit NULL,
    [删除] bit NULL,
    [打印] bit NULL,
    [单价] bit NULL,
    [金额] bit NULL,
    [审核] bit NULL,
    [点击数] real NULL,
    [反审核] bit NULL,
    [功能] bit NULL
);

CREATE TABLE [人事档案] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [自动编号] nvarchar(10) NULL,
    [编号] nvarchar(10) NULL,
    [姓名] nvarchar(20) NULL,
    [考勤卡号] nvarchar(12) NULL,
    [出生日期] datetime2(0) NULL,
    [性别] nvarchar(5) NULL,
    [部门编号] nvarchar(20) NULL,
    [职称] nvarchar(20) NULL,
    [工序类型] nvarchar(30) NULL,
    [电话] nvarchar(40) NULL,
    [手机] nvarchar(40) NULL,
    [身份证号] nvarchar(20) NULL,
    [入职日期] datetime NULL,
    [离职日期] datetime NULL,
    [现地址] nvarchar(100) NULL,
    [地址] nvarchar(100) NULL,
    [基本工资] decimal(18,4) NULL,
    [暂住证] nvarchar(8) NULL,
    [图片] varbinary(max) NULL,
    [备注] nvarchar(max) NULL,
    [在职] nvarchar(2) NULL,
    [曾使用卡号] nvarchar(max) NULL,
    [默认班次] nvarchar(20) NULL,
    [默认班次B] nvarchar(20) NULL,
    [考勤注册] nvarchar(4) NULL,
    [住宿水电费] decimal(18,4) NULL,
    [伙食费] decimal(18,4) NULL,
    [社保费] decimal(18,4) NULL
);

CREATE TABLE [仓库] (
    [编号] nvarchar(10) NULL,
    [名称] nvarchar(40) NULL,
    [所属地区] nvarchar(20) NULL,
    [负责人] nvarchar(20) NULL,
    [电话] nvarchar(30) NULL,
    [地址] nvarchar(40) NULL,
    [StartNo] bigint NULL
);

CREATE TABLE [供应商类别] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [供应商类别] nvarchar(6) NULL,
    [供应商名称] nvarchar(20) NULL
);

CREATE TABLE [供应商资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [供应商类别] nvarchar(10) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(50) NULL,
    [联系人] nvarchar(20) NULL,
    [职务] nvarchar(20) NULL,
    [手机] nvarchar(30) NULL,
    [电话] nvarchar(30) NULL,
    [传真] nvarchar(30) NULL,
    [联系地址] nvarchar(40) NULL,
    [邮政编码] nvarchar(10) NULL,
    [电子邮箱] nvarchar(50) NULL,
    [付款方式] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL,
    [货币] nvarchar(20) NULL
);

CREATE TABLE [入仓调价表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [入仓单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [性质] nvarchar(16) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [原单价] money NULL,
    [修改单价] money NULL,
    [修改原因] nvarchar(150) NULL
);

CREATE TABLE [加工厂类别] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [加工厂类别] nvarchar(6) NULL,
    [加工厂名称] nvarchar(20) NULL
);

CREATE TABLE [加工厂资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [加工厂类别] nvarchar(10) NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(50) NULL,
    [联系人] nvarchar(20) NULL,
    [职务] nvarchar(20) NULL,
    [手机] nvarchar(30) NULL,
    [电话] nvarchar(30) NULL,
    [传真] nvarchar(30) NULL,
    [联系地址] nvarchar(40) NULL,
    [邮政编码] nvarchar(10) NULL,
    [电子邮箱] nvarchar(50) NULL,
    [付款方式] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL
);

CREATE TABLE [半成品入仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [部门] nvarchar(40) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [半成品入仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [部门] nvarchar(40) NULL,
    [订单单号] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [客户] nvarchar(30) NULL,
    [客户合同号] nvarchar(50) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [货号] nvarchar(40) NULL,
    [名称] nvarchar(40) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL,
    [付款方式] nvarchar(10) NULL,
    [预算数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_18_单号 ON [半成品入仓明细单]([单号]);

CREATE TABLE [半成品盘点单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [仓库] nvarchar(20) NULL,
    [部门] nvarchar(40) NULL,
    [系统数量] real NULL,
    [盘点数量] real NULL,
    [盈亏数量] real NULL,
    [金额] money NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [半成品盘点明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [仓库] nvarchar(20) NULL,
    [部门] nvarchar(40) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [客户] nvarchar(30) NULL,
    [客户合同号] nvarchar(50) NULL,
    [货号] nvarchar(40) NULL,
    [名称] nvarchar(40) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [系统数量] real NULL,
    [盘点数量] real NULL,
    [盈亏数量] real NULL,
    [库存单价] money NULL,
    [库存金额] money NULL,
    [单价] money NULL,
    [金额] money NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_20_单号 ON [半成品盘点明细单]([单号]);

CREATE TABLE [半成品领料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [部门] nvarchar(40) NULL,
    [合同] nvarchar(40) NULL,
    [手工单号] nvarchar(40) NULL,
    [领料人] nvarchar(10) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [半成品领料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [部门] nvarchar(40) NULL,
    [领料人] nvarchar(15) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [客户] nvarchar(30) NULL,
    [客户合同号] nvarchar(50) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [合同] nvarchar(40) NULL,
    [手工单号] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [货号] nvarchar(40) NULL,
    [名称] nvarchar(40) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL,
    [付款方式] nvarchar(10) NULL,
    [预算数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_22_单号 ON [半成品领料明细单]([单号]);

CREATE TABLE [原始记录] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [机器号] nvarchar(10) NULL,
    [日期] datetime2(0) NULL,
    [刷卡时间] datetime NULL,
    [卡号] nvarchar(10) NULL,
    [工号] nvarchar(30) NULL,
    [字节] nvarchar(10) NULL,
    [类型] nvarchar(10) NULL,
    [操作日期] datetime NULL,
    [备注] nvarchar(max) NULL,
    [记录] nvarchar(25) NULL
);

CREATE TABLE [发外加工付款单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [发外单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [金额] money NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [发外加工付款明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [发外单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [货款金额] money NULL,
    [付款金额] money NULL,
    [尚欠金额] money NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_25_单号 ON [发外加工付款明细单]([单号]);

CREATE TABLE [发外加工单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [发外加工对数表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [发外单号] nvarchar(20) NULL,
    [发外日期] datetime NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [加工项目] nvarchar(30) NULL,
    [发外数量] decimal(18,4) NULL,
    [回收数量] decimal(18,4) NULL,
    [相差数量] decimal(18,4) NULL,
    [结款数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [扣款] decimal(18,4) NULL,
    [总金额] decimal(18,4) NULL,
    [对数] nvarchar(4) NULL,
    [备注] nvarchar(10) NULL,
    [操作日期] datetime NULL
);

CREATE TABLE [发外加工总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [加工项目] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [对数] nvarchar(4) NULL
);

CREATE TABLE [发外加工明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [加工项目] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE INDEX IX_29_单号 ON [发外加工明细单]([单号]);

CREATE TABLE [发外加工项目] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [加工项目] nvarchar(40) NULL,
    [单价] decimal(18,4) NULL,
    [备注] nvarchar(50) NULL
);

CREATE TABLE [发外回收单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [发外单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [发外数量] decimal(18,4) NULL,
    [回收数量] decimal(18,4) NULL,
    [相差数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [客户前欠款] decimal(18,4) NULL,
    [本次收款] decimal(18,4) NULL,
    [已收金额] decimal(18,4) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [发外回收总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [发外单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [加工项目] nvarchar(30) NULL,
    [库存数量] decimal(18,4) NULL,
    [发外数量] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [欠数] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [明细库存] nvarchar(500) NULL,
    [发外数组] nvarchar(450) NULL,
    [欠数组] nvarchar(450) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [发外回收明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [发外单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [加工项目] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [发外数量] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [欠数] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE INDEX IX_33_单号 ON [发外回收明细单]([单号]);

CREATE TABLE [员工卡号登记] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [考勤卡号] nvarchar(12) NULL,
    [自动编号] nvarchar(12) NULL,
    [员工编号] nvarchar(12) NULL,
    [开始日期] datetime NULL,
    [结束日期] datetime NULL,
    [备注] nvarchar(20) NULL
);

CREATE TABLE [基本资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [资料类别] nvarchar(6) NULL,
    [序号] nvarchar(5) NULL,
    [基本资料] nvarchar(30) NULL
);

CREATE TABLE [头办单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [头办单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(50) NULL,
    [日期] datetime NULL,
    [开单日期] datetime NULL,
    [交版日期] datetime NULL,
    [制单人] nvarchar(12) NULL,
    [跟单员] nvarchar(12) NULL,
    [操作员] nvarchar(30) NULL,
    [审核] nvarchar(2) NULL,
    [完成] nvarchar(6) NULL,
    [布料] nvarchar(40) NULL,
    [主料] nvarchar(50) NULL,
    [克重幅宽] nvarchar(50) NULL,
    [印花或其它] nvarchar(50) NULL,
    [数量] decimal(18,4) NULL,
    [生产车间] nvarchar(30) NULL,
    [副本送] nvarchar(100) NULL,
    [商标] nvarchar(50) NULL,
    [备注] nvarchar(40) NULL,
    [单位] nvarchar(20) NULL
);

CREATE TABLE [头办单图片] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [头办单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [物料用量] nvarchar(max) NULL,
    [图片] varbinary(max) NULL,
    [图片路径] nvarchar(90) NULL,
    [批办备注] nvarchar(max) NULL
);

CREATE TABLE [头办单尺码表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [头办单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [序号] real NULL,
    [尺寸表] nvarchar(40) NULL,
    [尺码1] nvarchar(20) NULL,
    [尺码2] nvarchar(20) NULL,
    [尺码3] nvarchar(20) NULL,
    [尺码4] nvarchar(20) NULL,
    [尺码5] nvarchar(20) NULL,
    [尺码6] nvarchar(20) NULL,
    [尺码7] nvarchar(20) NULL,
    [尺码8] nvarchar(20) NULL,
    [尺码9] nvarchar(20) NULL,
    [尺码10] nvarchar(20) NULL,
    [尺码11] nvarchar(20) NULL,
    [尺码12] nvarchar(20) NULL,
    [尺码13] nvarchar(20) NULL,
    [尺码14] nvarchar(20) NULL,
    [尺码15] nvarchar(20) NULL,
    [尺码16] nvarchar(20) NULL,
    [尺码17] nvarchar(20) NULL,
    [尺码18] nvarchar(20) NULL,
    [尺码19] nvarchar(20) NULL,
    [尺码20] nvarchar(20) NULL,
    [尺码21] nvarchar(20) NULL,
    [尺码22] nvarchar(20) NULL,
    [尺码23] nvarchar(20) NULL,
    [尺码24] nvarchar(20) NULL,
    [尺码25] nvarchar(20) NULL,
    [尺码26] nvarchar(20) NULL,
    [尺码27] nvarchar(20) NULL,
    [尺码28] nvarchar(20) NULL,
    [尺码29] nvarchar(20) NULL,
    [尺码30] nvarchar(20) NULL
);

CREATE TABLE [委托发外加工单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [扎号条码] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(40) NULL,
    [裁床单号] nvarchar(30) NULL,
    [裁床日期] datetime NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [扎号] real NULL,
    [加工项目] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [发外数量] decimal(18,4) NULL,
    [回收数量] decimal(18,4) NULL,
    [回收日期] datetime NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [客户类别] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [客户类别] nvarchar(6) NULL,
    [客户名称] nvarchar(20) NULL
);

CREATE TABLE [客户资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [客户类别] nvarchar(10) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(50) NULL,
    [联系人] nvarchar(20) NULL,
    [职务] nvarchar(20) NULL,
    [手机] nvarchar(30) NULL,
    [电话] nvarchar(30) NULL,
    [传真] nvarchar(30) NULL,
    [联系地址] nvarchar(40) NULL,
    [邮政编码] nvarchar(10) NULL,
    [电子邮箱] nvarchar(50) NULL,
    [客户类型] nvarchar(10) NULL,
    [付款方式] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL
);

CREATE TABLE [工票打印设置] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [行号] real NULL,
    [左边] nvarchar(10) NULL,
    [中间] nvarchar(20) NULL,
    [右边] nvarchar(10) NULL
);

CREATE TABLE [工票格式] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(30) NULL,
    [行号] real NULL,
    [左边工序] nvarchar(80) NULL,
    [右边工序] nvarchar(80) NULL
);

CREATE TABLE [工票裁片] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(50) NULL,
    [行号] real NULL,
    [裁片] nvarchar(40) NULL
);

CREATE TABLE [工资总表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [工资表编号] nvarchar(30) NULL,
    [月份] nvarchar(20) NULL,
    [部门编号] nvarchar(20) NULL,
    [模板编号] nvarchar(20) NULL,
    [开始日期] datetime NULL,
    [结束日期] datetime NULL,
    [审核] nvarchar(6) NULL,
    [操作员] nvarchar(30) NULL,
    [基本工资] decimal(18,4) NULL,
    [计件工资] decimal(18,4) NULL,
    [应发合计] decimal(18,4) NULL,
    [应扣合计] decimal(18,4) NULL,
    [实发合计] decimal(18,4) NULL
);

CREATE TABLE [工资明细表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [工资表编号] nvarchar(30) NULL,
    [月份] nvarchar(10) NULL,
    [自动编号] nvarchar(20) NULL,
    [编号] nvarchar(20) NULL,
    [姓名] nvarchar(20) NULL,
    [部门编号] nvarchar(20) NULL,
    [部门] nvarchar(30) NULL,
    [职称] nvarchar(20) NULL,
    [基本工资] decimal(18,4) NULL,
    [计件工资] decimal(18,4) NULL,
    [应发合计] decimal(18,4) NULL,
    [应扣合计] decimal(18,4) NULL,
    [实发合计] decimal(18,4) NULL,
    [ZG01] decimal(18,4) NULL,
    [ZG02] decimal(18,4) NULL,
    [ZG03] decimal(18,4) NULL,
    [ZG04] decimal(18,4) NULL,
    [ZG05] decimal(18,4) NULL,
    [ZG06] decimal(18,4) NULL,
    [ZG07] decimal(18,4) NULL,
    [ZG08] decimal(18,4) NULL,
    [ZG09] decimal(18,4) NULL,
    [ZG10] decimal(18,4) NULL,
    [ZG11] decimal(18,4) NULL,
    [ZG12] decimal(18,4) NULL,
    [ZG13] decimal(18,4) NULL,
    [ZG14] decimal(18,4) NULL,
    [ZG15] decimal(18,4) NULL,
    [ZG16] decimal(18,4) NULL,
    [ZG17] decimal(18,4) NULL,
    [ZG18] decimal(18,4) NULL,
    [ZG19] decimal(18,4) NULL,
    [ZG20] decimal(18,4) NULL,
    [ZG21] decimal(18,4) NULL,
    [ZG22] decimal(18,4) NULL,
    [ZG23] decimal(18,4) NULL,
    [ZG24] decimal(18,4) NULL,
    [ZG25] decimal(18,4) NULL,
    [ZG26] decimal(18,4) NULL,
    [ZG27] decimal(18,4) NULL,
    [ZG28] decimal(18,4) NULL,
    [ZG29] decimal(18,4) NULL,
    [ZG30] decimal(18,4) NULL,
    [ZG31] decimal(18,4) NULL,
    [ZG32] decimal(18,4) NULL,
    [ZG33] decimal(18,4) NULL,
    [ZG34] decimal(18,4) NULL,
    [ZG35] decimal(18,4) NULL,
    [ZG36] decimal(18,4) NULL,
    [ZG37] decimal(18,4) NULL,
    [ZG38] decimal(18,4) NULL,
    [ZG39] decimal(18,4) NULL,
    [ZG40] decimal(18,4) NULL,
    [ZG41] decimal(18,4) NULL,
    [ZG42] decimal(18,4) NULL,
    [ZG43] decimal(18,4) NULL,
    [ZG44] decimal(18,4) NULL,
    [ZG45] decimal(18,4) NULL,
    [ZG46] decimal(18,4) NULL,
    [ZG47] decimal(18,4) NULL,
    [ZG48] decimal(18,4) NULL,
    [ZG49] decimal(18,4) NULL,
    [ZG50] decimal(18,4) NULL,
    [ZG51] decimal(18,4) NULL,
    [ZG52] decimal(18,4) NULL,
    [ZG53] decimal(18,4) NULL,
    [ZG54] decimal(18,4) NULL,
    [ZG55] decimal(18,4) NULL,
    [ZG56] decimal(18,4) NULL,
    [ZG57] decimal(18,4) NULL,
    [ZG58] decimal(18,4) NULL,
    [ZG59] decimal(18,4) NULL,
    [ZG60] decimal(18,4) NULL,
    [ZG61] decimal(18,4) NULL,
    [ZG62] decimal(18,4) NULL,
    [ZG63] decimal(18,4) NULL,
    [ZG64] decimal(18,4) NULL,
    [ZG65] decimal(18,4) NULL,
    [ZG66] decimal(18,4) NULL,
    [ZG67] decimal(18,4) NULL,
    [ZG68] decimal(18,4) NULL,
    [ZG69] decimal(18,4) NULL,
    [ZG70] decimal(18,4) NULL
);

CREATE INDEX IX_46_单号 ON [工资明细表]([单号]);

CREATE TABLE [工资模板公式] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [模板编号] nvarchar(20) NULL,
    [模板名称] nvarchar(30) NULL,
    [部门编号] nvarchar(20) NULL,
    [部门名称] nvarchar(30) NULL,
    [序号] real NULL,
    [台头项目] nvarchar(50) NULL,
    [公式] nvarchar(500) NULL
);

CREATE TABLE [工资模板项目] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [模板编号] nvarchar(10) NULL,
    [模板名称] nvarchar(30) NULL,
    [序号] real NULL,
    [台头项目] nvarchar(30) NULL,
    [类型] nvarchar(12) NULL
);

CREATE TABLE [工资表统计日期] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [月份] nvarchar(16) NULL,
    [开始日期] datetime NULL,
    [结束日期] datetime NULL
);

CREATE TABLE [工资表项目公式] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [工资表编号] nvarchar(30) NULL,
    [月份] nvarchar(20) NULL,
    [部门编号] nvarchar(20) NULL,
    [台头项目] nvarchar(30) NULL,
    [类型] nvarchar(12) NULL,
    [公式] nvarchar(500) NULL,
    [列名] nvarchar(6) NULL
);

CREATE TABLE [成品仓] (
    [编号] nvarchar(10) NULL,
    [名称] nvarchar(40) NULL,
    [所属地区] nvarchar(20) NULL,
    [负责人] nvarchar(20) NULL,
    [电话] nvarchar(30) NULL,
    [地址] nvarchar(40) NULL,
    [StartNo] bigint NULL
);

CREATE TABLE [成品入仓付款单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [入仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [金额] money NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [成品入仓付款明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [入仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [货款金额] money NULL,
    [付款金额] money NULL,
    [尚欠金额] money NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_53_单号 ON [成品入仓付款明细单]([单号]);

CREATE TABLE [成品入仓单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [成品入仓总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE TABLE [成品入仓明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE INDEX IX_56_单号 ON [成品入仓明细单]([单号]);

CREATE TABLE [成品出仓单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [客户前欠款] decimal(18,4) NULL,
    [本次收款] decimal(18,4) NULL,
    [已收金额] decimal(18,4) NULL,
    [计算帐款] nvarchar(6) NULL,
    [发票号] nvarchar(50) NULL,
    [CMT发票号] nvarchar(50) NULL
);

CREATE TABLE [成品出仓总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [库存数量] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [明细库存] nvarchar(500) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL,
    [发票号] nvarchar(50) NULL,
    [CMT发票号] nvarchar(50) NULL
);

CREATE TABLE [成品出仓明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL,
    [发票号] nvarchar(50) NULL,
    [CMT发票号] nvarchar(50) NULL
);

CREATE INDEX IX_59_单号 ON [成品出仓明细单]([单号]);

CREATE TABLE [成品客户收款单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [出仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [金额] money NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [成品客户收款明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [出仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [货款金额] money NULL,
    [收款金额] money NULL,
    [应收金额] money NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_61_单号 ON [成品客户收款明细单]([单号]);

CREATE TABLE [成品客户订单总表] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(100) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE TABLE [成品客户订单明细表] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(100) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE INDEX IX_63_单号 ON [成品客户订单明细表]([单号]);

CREATE TABLE [成品客户订货单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(100) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [成品盘点单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [系统数量] decimal(18,4) NULL,
    [盘点数量] decimal(18,4) NULL,
    [盈亏数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [成品盘点总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [系统数量] decimal(18,4) NULL,
    [盘点数量] decimal(18,4) NULL,
    [盈亏数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [系统库存组] nvarchar(400) NULL,
    [盈亏组] nvarchar(400) NULL,
    [明细库存] nvarchar(500) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE TABLE [成品盘点明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [系统数量] decimal(18,4) NULL,
    [盘点数量] decimal(18,4) NULL,
    [盈亏数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE INDEX IX_67_单号 ON [成品盘点明细单]([单号]);

CREATE TABLE [成品调拨单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [源仓库] nvarchar(20) NULL,
    [目标仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [成品调拨总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [源仓库] nvarchar(20) NULL,
    [目标仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [库存数量] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [明细库存] nvarchar(500) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE TABLE [成品调拨明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [源仓库] nvarchar(20) NULL,
    [目标仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE INDEX IX_70_单号 ON [成品调拨明细单]([单号]);

CREATE TABLE [成品退仓单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [入仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [成品退仓总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [入仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE TABLE [成品退仓明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [入仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE INDEX IX_73_单号 ON [成品退仓明细单]([单号]);

CREATE TABLE [成品退货单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL
);

CREATE TABLE [成品退货总单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [颜色组] nvarchar(300) NULL,
    [尺码组] nvarchar(100) NULL,
    [数量组] nvarchar(400) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE TABLE [成品退货明细单] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [出仓单号] nvarchar(20) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [成本单价] decimal(18,4) NULL,
    [成本金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL,
    [备注] nvarchar(max) NULL,
    [计算帐款] nvarchar(6) NULL,
    [客户款号] nvarchar(50) NULL,
    [合同号] nvarchar(50) NULL
);

CREATE INDEX IX_76_单号 ON [成品退货明细单]([单号]);

CREATE TABLE [成衣冚检表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [扎号条码] nvarchar(20) NULL,
    [日期] datetime NULL,
    [裁床单号] nvarchar(30) NULL,
    [裁床日期] datetime NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [床号] nvarchar(30) NULL,
    [扎号] real NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [审核] nvarchar(10) NULL
);

CREATE TABLE [报价类别] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [编号] nvarchar(20) NULL,
    [名称] nvarchar(40) NULL,
    [类别] nvarchar(30) NULL,
    [备注] nvarchar(max) NULL
);

CREATE TABLE [报价资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [报价类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最底库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [备注] nvarchar(max) NULL
);

CREATE TABLE [排班表] (
    [工号] nvarchar(30) NULL,
    [姓名] nvarchar(30) NULL,
    [日期] datetime2(0) NULL,
    [班次] nvarchar(20) NULL,
    [ID] bigint NULL
);

CREATE TABLE [日报表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [工号] nvarchar(30) NULL,
    [姓名] nvarchar(30) NULL,
    [部门] nvarchar(30) NULL,
    [日期] datetime2(0) NULL,
    [刷卡1] datetime NULL,
    [刷卡2] datetime NULL,
    [刷卡3] datetime NULL,
    [刷卡4] datetime NULL,
    [刷卡5] datetime NULL,
    [刷卡6] datetime NULL,
    [刷卡7] datetime NULL,
    [刷卡8] datetime NULL,
    [刷卡9] datetime NULL,
    [刷卡10] datetime NULL,
    [刷卡11] datetime NULL,
    [刷卡12] datetime NULL,
    [上午] real NULL,
    [下午] real NULL,
    [合计时间] real NULL,
    [加班] real NULL,
    [总出勤时间] real NULL,
    [早退分] int NULL,
    [迟到分] int NULL,
    [备注] nvarchar(500) NULL,
    [职称] nvarchar(20) NULL,
    [显示卡号] nvarchar(20) NULL,
    [早退次数] int NULL,
    [迟到次数] int NULL,
    [迟到1] bit NULL,
    [早退1] bit NULL,
    [迟到2] bit NULL,
    [早退2] bit NULL,
    [迟到3] bit NULL,
    [早退3] bit NULL,
    [次数] int NULL,
    [出勤] int NULL,
    [正常上班时间] real NULL,
    [中午直落] bit NULL,
    [下午直落] bit NULL,
    [请假] real NULL,
    [通宵直落] bit NULL,
    [超时] int NULL,
    [夜宵] int NULL,
    [星期日次数] int NULL
);

CREATE TABLE [日报表签卡登记] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [工号] nvarchar(30) NULL,
    [姓名] nvarchar(30) NULL,
    [部门] nvarchar(30) NULL,
    [日期] datetime2(0) NULL,
    [刷卡1] datetime NULL,
    [刷卡2] datetime NULL,
    [刷卡3] datetime NULL,
    [刷卡4] datetime NULL,
    [刷卡5] datetime NULL,
    [刷卡6] datetime NULL,
    [刷卡7] datetime NULL,
    [刷卡8] datetime NULL,
    [刷卡9] datetime NULL,
    [刷卡10] datetime NULL,
    [刷卡11] datetime NULL,
    [刷卡12] datetime NULL,
    [上午] real NULL,
    [下午] real NULL,
    [合计时间] real NULL,
    [加班] real NULL,
    [总出勤时间] real NULL,
    [早退分] int NULL,
    [迟到分] int NULL,
    [备注] nvarchar(500) NULL,
    [职称] nvarchar(20) NULL,
    [显示卡号] nvarchar(20) NULL,
    [早退次数] int NULL,
    [迟到次数] int NULL,
    [迟到1] bit NULL,
    [早退1] bit NULL,
    [迟到2] bit NULL,
    [早退2] bit NULL,
    [迟到3] bit NULL,
    [早退3] bit NULL,
    [次数] int NULL,
    [出勤] int NULL,
    [正常上班时间] real NULL,
    [中午直落] bit NULL,
    [下午直落] bit NULL,
    [请假] real NULL,
    [通宵直落] bit NULL
);

CREATE TABLE [款号尺码表] (
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [尺码] nvarchar(20) NULL,
    [ID] bigint NULL
);

CREATE TABLE [款号总表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(50) NULL,
    [单价] decimal(18,4) NULL,
    [成本价] decimal(18,4) NULL,
    [批发价] decimal(18,4) NULL,
    [零售价] decimal(18,4) NULL
);

CREATE TABLE [款号明细表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [工序号] nvarchar(5) NULL,
    [工序名称] nvarchar(60) NULL,
    [单价] decimal(18,4) NULL,
    [工序类型] nvarchar(20) NULL,
    [备注] nvarchar(50) NULL
);

CREATE INDEX IX_85_单号 ON [款号明细表]([单号]);

CREATE TABLE [款号物料台头] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期] datetime NULL,
    [款号] nvarchar(40) NULL,
    [台头] nvarchar(20) NULL,
    [审核] nvarchar(2) NULL,
    [操作员] nvarchar(20) NULL
);

CREATE TABLE [款号物料图片] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期] datetime NULL,
    [款号] nvarchar(50) NULL,
    [款式] nvarchar(50) NULL,
    [图片] varbinary(max) NULL,
    [制作方法] nvarchar(max) NULL,
    [审核] nvarchar(2) NULL,
    [操作员] nvarchar(20) NULL,
    [图片路径] nvarchar(80) NULL,
    [裁床工艺] nvarchar(max) NULL,
    [车缝工艺] nvarchar(max) NULL,
    [手工工艺] nvarchar(max) NULL
);

CREATE TABLE [款号物料尺寸表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [客户] nvarchar(40) NULL,
    [款号] nvarchar(50) NULL,
    [款式] nvarchar(50) NULL,
    [审核] nvarchar(2) NULL,
    [操作员] nvarchar(20) NULL,
    [部位] nvarchar(40) NULL,
    [序号] nvarchar(4) NULL,
    [尺码1] nvarchar(20) NULL,
    [尺码2] nvarchar(20) NULL,
    [尺码3] nvarchar(20) NULL,
    [尺码4] nvarchar(20) NULL,
    [尺码5] nvarchar(20) NULL,
    [尺码6] nvarchar(20) NULL,
    [尺码7] nvarchar(20) NULL,
    [尺码8] nvarchar(20) NULL,
    [尺码9] nvarchar(20) NULL,
    [尺码10] nvarchar(20) NULL,
    [尺码11] nvarchar(20) NULL,
    [尺码12] nvarchar(20) NULL,
    [尺码13] nvarchar(20) NULL,
    [尺码14] nvarchar(20) NULL,
    [尺码15] nvarchar(20) NULL,
    [尺码16] nvarchar(20) NULL,
    [尺码17] nvarchar(20) NULL,
    [尺码18] nvarchar(20) NULL,
    [尺码19] nvarchar(20) NULL,
    [尺码20] nvarchar(20) NULL,
    [尺码21] nvarchar(20) NULL,
    [尺码22] nvarchar(20) NULL,
    [尺码23] nvarchar(20) NULL,
    [尺码24] nvarchar(20) NULL,
    [尺码25] nvarchar(20) NULL,
    [尺码26] nvarchar(20) NULL,
    [尺码27] nvarchar(20) NULL,
    [尺码28] nvarchar(20) NULL,
    [尺码29] nvarchar(20) NULL,
    [尺码30] nvarchar(20) NULL,
    [公差] nvarchar(10) NULL
);

CREATE TABLE [款号物料总表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期] datetime NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [客户] nvarchar(40) NULL,
    [产品编号] nvarchar(30) NULL,
    [款号] nvarchar(50) NULL,
    [款式] nvarchar(50) NULL,
    [使用数量] decimal(18,4) NULL,
    [大箱盒数] decimal(18,4) NULL,
    [图片] varbinary(max) NULL,
    [制作要求] nvarchar(max) NULL,
    [审核] nvarchar(2) NULL,
    [操作员] nvarchar(20) NULL,
    [备注] nvarchar(150) NULL,
    [单位] nvarchar(20) NULL
);

CREATE TABLE [款号物料明细表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期] datetime NULL,
    [顺序] nvarchar(6) NULL,
    [产品编号] nvarchar(30) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [款号] nvarchar(50) NULL,
    [款式] nvarchar(30) NULL,
    [使用数量] decimal(18,4) NULL,
    [大箱盒数] decimal(18,4) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(50) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [客户] nvarchar(30) NULL,
    [单位] nvarchar(20) NULL,
    [尺码1] decimal(18,4) NULL,
    [尺码2] decimal(18,4) NULL,
    [尺码3] decimal(18,4) NULL,
    [尺码4] decimal(18,4) NULL,
    [尺码5] decimal(18,4) NULL,
    [尺码6] decimal(18,4) NULL,
    [尺码7] decimal(18,4) NULL,
    [尺码8] decimal(18,4) NULL,
    [尺码9] decimal(18,4) NULL,
    [尺码10] decimal(18,4) NULL,
    [尺码11] decimal(18,4) NULL,
    [尺码12] decimal(18,4) NULL,
    [尺码13] decimal(18,4) NULL,
    [尺码14] decimal(18,4) NULL,
    [尺码15] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [备注] nvarchar(20) NULL,
    [仓库位置] nvarchar(30) NULL,
    [审核] nvarchar(2) NULL,
    [操作员] nvarchar(20) NULL
);

CREATE INDEX IX_90_单号 ON [款号物料明细表]([单号]);

CREATE TABLE [款号颜色表] (
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(40) NULL,
    [颜色编号] nvarchar(20) NULL,
    [颜色名称] nvarchar(40) NULL,
    [ID] bigint NULL
);

CREATE TABLE [法定假期] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [法定假期] nvarchar(20) NULL,
    [备注] nvarchar(40) NULL
);

CREATE TABLE [法定假期明细] (
    [ID] int IDENTITY(1,1) PRIMARY KEY,
    [编号] nvarchar(30) NULL,
    [日期] datetime2(0) NULL,
    [新农历] nvarchar(10) NULL
);

CREATE TABLE [物料类别] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [编号] nvarchar(20) NULL,
    [名称] nvarchar(40) NULL,
    [类别] nvarchar(30) NULL,
    [备注] nvarchar(max) NULL
);

CREATE TABLE [物料资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(30) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [客户] nvarchar(20) NULL,
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最低库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [备注] nvarchar(max) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(50) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [款历史] nvarchar(500) NULL,
    [单号日期] datetime NULL,
    [仓库位置] nvarchar(30) NULL,
    [货号] nvarchar(40) NULL,
    [码换算] nvarchar(20) NULL,
    [货币] nvarchar(20) NULL
);

CREATE TABLE [生产BOM物料清单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期] datetime NULL,
    [制单日期] datetime NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(30) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [总数量] decimal(18,4) NULL,
    [库存数量] decimal(18,4) NULL,
    [可用库存] decimal(18,4) NULL,
    [需订数量] decimal(18,4) NULL,
    [订货数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(50) NULL,
    [审核] nvarchar(2) NULL,
    [已阅用户] nvarchar(100) NULL,
    [供应商] nvarchar(50) NULL,
    [供应商编号] nvarchar(10) NULL,
    [供应商名称] nvarchar(40) NULL
);

CREATE TABLE [生产制单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(50) NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(50) NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [制单人] nvarchar(12) NULL,
    [跟单员] nvarchar(12) NULL,
    [操作员] nvarchar(30) NULL,
    [计划数量] decimal(18,4) NULL,
    [裁床数量] decimal(18,4) NULL,
    [录入数量] decimal(18,4) NULL,
    [工序数] real NULL,
    [工序单价] decimal(18,4) NULL,
    [物料金额] decimal(18,4) NULL,
    [出货单价] decimal(18,4) NULL,
    [审核] nvarchar(2) NULL,
    [完成] nvarchar(6) NULL,
    [工序审核] nvarchar(2) NULL,
    [布料] nvarchar(40) NULL,
    [生产车间] nvarchar(30) NULL,
    [副本送] nvarchar(100) NULL,
    [商标] nvarchar(50) NULL,
    [备注] nvarchar(40) NULL,
    [是否入仓] nvarchar(10) NULL,
    [是否出仓] nvarchar(10) NULL,
    [下单日期] datetime NULL,
    [走船日期] datetime NULL,
    [新唯美发票号] nvarchar(100) NULL,
    [CMT发票号] nvarchar(100) NULL,
    [工序日期] datetime NULL,
    [尺寸单位] nvarchar(10) NULL,
    [物料清单] nvarchar(30) NULL,
    [物料尺码] nvarchar(30) NULL,
    [BOM审核] nvarchar(2) NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [生产制单图片] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [制作方法] nvarchar(max) NULL,
    [图片] varbinary(max) NULL,
    [图片路径] nvarchar(90) NULL,
    [折衣图片] varbinary(max) NULL,
    [折衣路径] nvarchar(90) NULL,
    [折衣方法] nvarchar(max) NULL,
    [标识图片] varbinary(max) NULL,
    [标识路径] nvarchar(90) NULL,
    [裁床工艺] nvarchar(max) NULL,
    [车缝工艺] nvarchar(max) NULL,
    [手工工艺] nvarchar(max) NULL
);

CREATE TABLE [生产制单尺寸] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [部位] nvarchar(50) NULL,
    [序号] real NULL,
    [尺码1] nvarchar(20) NULL,
    [尺码2] nvarchar(20) NULL,
    [尺码3] nvarchar(20) NULL,
    [尺码4] nvarchar(20) NULL,
    [尺码5] nvarchar(20) NULL,
    [尺码6] nvarchar(20) NULL,
    [尺码7] nvarchar(20) NULL,
    [尺码8] nvarchar(20) NULL,
    [尺码9] nvarchar(20) NULL,
    [尺码10] nvarchar(20) NULL,
    [尺码11] nvarchar(20) NULL,
    [尺码12] nvarchar(20) NULL,
    [尺码13] nvarchar(20) NULL,
    [尺码14] nvarchar(20) NULL,
    [尺码15] nvarchar(20) NULL,
    [尺码16] nvarchar(20) NULL,
    [尺码17] nvarchar(20) NULL,
    [尺码18] nvarchar(20) NULL,
    [尺码19] nvarchar(20) NULL,
    [尺码20] nvarchar(20) NULL,
    [尺码21] nvarchar(20) NULL,
    [尺码22] nvarchar(20) NULL,
    [尺码23] nvarchar(20) NULL,
    [尺码24] nvarchar(20) NULL,
    [尺码25] nvarchar(20) NULL,
    [尺码26] nvarchar(20) NULL,
    [尺码27] nvarchar(20) NULL,
    [尺码28] nvarchar(20) NULL,
    [尺码29] nvarchar(20) NULL,
    [尺码30] nvarchar(20) NULL,
    [公差] nvarchar(20) NULL
);

CREATE TABLE [生产制单尺码表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [序号] real NULL,
    [颜色] nvarchar(40) NULL,
    [尺码1] nvarchar(20) NULL,
    [尺码2] nvarchar(20) NULL,
    [尺码3] nvarchar(20) NULL,
    [尺码4] nvarchar(20) NULL,
    [尺码5] nvarchar(20) NULL,
    [尺码6] nvarchar(20) NULL,
    [尺码7] nvarchar(20) NULL,
    [尺码8] nvarchar(20) NULL,
    [尺码9] nvarchar(20) NULL,
    [尺码10] nvarchar(20) NULL,
    [尺码11] nvarchar(20) NULL,
    [尺码12] nvarchar(20) NULL,
    [尺码13] nvarchar(20) NULL,
    [尺码14] nvarchar(20) NULL,
    [尺码15] nvarchar(20) NULL,
    [尺码16] nvarchar(20) NULL,
    [尺码17] nvarchar(20) NULL,
    [尺码18] nvarchar(20) NULL,
    [尺码19] nvarchar(20) NULL,
    [尺码20] nvarchar(20) NULL,
    [尺码21] nvarchar(20) NULL,
    [尺码22] nvarchar(20) NULL,
    [尺码23] nvarchar(20) NULL,
    [尺码24] nvarchar(20) NULL,
    [尺码25] nvarchar(20) NULL,
    [尺码26] nvarchar(20) NULL,
    [尺码27] nvarchar(20) NULL,
    [尺码28] nvarchar(20) NULL,
    [尺码29] nvarchar(20) NULL,
    [尺码30] nvarchar(20) NULL
);

CREATE TABLE [生产制单工序表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [工序号] nvarchar(10) NULL,
    [工序名称] nvarchar(50) NULL,
    [单价] decimal(18,4) NULL,
    [工序类型] nvarchar(20) NULL,
    [备注] nvarchar(100) NULL,
    [审核] nvarchar(5) NULL,
    [工序设置] nvarchar(10) NULL
);

CREATE TABLE [生产制单数量] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(50) NULL,
    [款式] nvarchar(50) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [日期] datetime NULL,
    [客户编号] nvarchar(15) NULL,
    [客户名称] nvarchar(40) NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(50) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL
);

CREATE TABLE [生产制单物料台头] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [日期] datetime NULL,
    [生产单号] nvarchar(40) NULL,
    [款号] nvarchar(40) NULL,
    [台头] nvarchar(20) NULL,
    [审核] nvarchar(2) NULL,
    [操作员] nvarchar(20) NULL
);

CREATE TABLE [生产制单物料清单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(30) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [尺码1] decimal(18,4) NULL,
    [尺码2] decimal(18,4) NULL,
    [尺码3] decimal(18,4) NULL,
    [尺码4] decimal(18,4) NULL,
    [尺码5] decimal(18,4) NULL,
    [尺码6] decimal(18,4) NULL,
    [尺码7] decimal(18,4) NULL,
    [尺码8] decimal(18,4) NULL,
    [尺码9] decimal(18,4) NULL,
    [尺码10] decimal(18,4) NULL,
    [尺码11] decimal(18,4) NULL,
    [尺码12] decimal(18,4) NULL,
    [尺码13] decimal(18,4) NULL,
    [尺码14] decimal(18,4) NULL,
    [尺码15] decimal(18,4) NULL,
    [码1] decimal(18,4) NULL,
    [码2] decimal(18,4) NULL,
    [码3] decimal(18,4) NULL,
    [码4] decimal(18,4) NULL,
    [码5] decimal(18,4) NULL,
    [码6] decimal(18,4) NULL,
    [码7] decimal(18,4) NULL,
    [码8] decimal(18,4) NULL,
    [码9] decimal(18,4) NULL,
    [码10] decimal(18,4) NULL,
    [码11] decimal(18,4) NULL,
    [码12] decimal(18,4) NULL,
    [码13] decimal(18,4) NULL,
    [码14] decimal(18,4) NULL,
    [码15] decimal(18,4) NULL,
    [制单数量] decimal(18,4) NULL,
    [单件用量] decimal(18,4) NULL,
    [计划用量] decimal(18,4) NULL,
    [损耗比率] decimal(18,4) NULL,
    [损耗数量] decimal(18,4) NULL,
    [总数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(50) NULL,
    [主料] nvarchar(8) NULL,
    [码换算] nvarchar(20) NULL,
    [裁片名称] nvarchar(40) NULL,
    [开料方法] nvarchar(30) NULL,
    [实排刀数] nvarchar(30) NULL,
    [尺寸] nvarchar(50) NULL
);

CREATE TABLE [用bqr户] (
    [PID] bigint NULL,
    [用户] nvarchar(20) NULL,
    [密码] nvarchar(60) NULL,
    [权限] nvarchar(40) NULL
);

CREATE TABLE [盘点单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [仓库] nvarchar(20) NULL,
    [系统数量] real NULL,
    [盘点数量] real NULL,
    [盈亏数量] real NULL,
    [金额] money NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [盘点明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [系统数量] real NULL,
    [盘点数量] real NULL,
    [盈亏数量] real NULL,
    [库存单价] money NULL,
    [库存金额] money NULL,
    [单价] money NULL,
    [金额] money NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_107_单号 ON [盘点明细单]([单号]);

CREATE TABLE [考勤_排班表] (
    [排班ID] bigint NULL,
    [识别] nvarchar(10) NULL,
    [名称] nvarchar(20) NULL,
    [刷卡间隔1] datetime NULL,
    [上午上班] datetime NULL,
    [刷卡间隔2] datetime NULL,
    [上午下班] datetime NULL,
    [刷卡间隔3] datetime NULL,
    [下午上班] datetime NULL,
    [刷卡间隔4] datetime NULL,
    [下午下班] datetime NULL,
    [刷卡间隔5] datetime NULL,
    [晚上上班] datetime NULL,
    [刷卡间隔6] datetime NULL,
    [晚上下班] datetime NULL,
    [刷卡间隔7] datetime NULL,
    [总小时] real NULL,
    [迟到分钟] real NULL,
    [早退分钟] real NULL,
    [直落班起计分钟] real NULL
);

CREATE TABLE [考勤_设备列表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [串口] nvarchar(20) NULL,
    [设备号] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL,
    [间隔时间] real NULL,
    [注册人数] real NULL,
    [液晶对比度] nvarchar(50) NULL,
    [曾使用卡号] nvarchar(max) NULL
);

CREATE TABLE [表格设置] (
    [用户] nvarchar(30) NULL,
    [表格名称] nvarchar(30) NULL,
    [默认名称] nvarchar(30) NULL,
    [显示名称] nvarchar(40) NULL,
    [宽度] nvarchar(50) NULL,
    [是否显示] bit NULL,
    [ID] bigint NULL
);

CREATE TABLE [裁床公式台头] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [位置] nvarchar(10) NULL,
    [项目] nvarchar(30) NULL
);

CREATE TABLE [裁床工资] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [月份] nvarchar(12) NULL,
    [日期] datetime NULL,
    [裁床单号] nvarchar(30) NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(50) NULL,
    [床号] nvarchar(20) NULL,
    [裁床数量] decimal(18,4) NULL,
    [裁床单价] decimal(18,4) NULL,
    [裁床金额] decimal(18,4) NULL,
    [G1] nvarchar(50) NULL,
    [G2] nvarchar(50) NULL,
    [G3] nvarchar(50) NULL,
    [备注1] nvarchar(50) NULL,
    [备注2] nvarchar(50) NULL
);

CREATE TABLE [裁床总表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [裁床单号] nvarchar(10) NULL,
    [生产单号] nvarchar(30) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(50) NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(50) NULL,
    [市场] nvarchar(25) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [日期] datetime NULL,
    [床号] nvarchar(20) NULL,
    [开始扎号] real NULL,
    [结束扎号] real NULL,
    [裁床数量] decimal(18,4) NULL,
    [布种] nvarchar(50) NULL,
    [唛长] decimal(18,4) NULL,
    [副宽] decimal(18,4) NULL,
    [件数] decimal(18,4) NULL,
    [布条数] decimal(18,4) NULL,
    [用料数] decimal(18,4) NULL,
    [余料数] decimal(18,4) NULL,
    [操作员] nvarchar(30) NULL,
    [审核] nvarchar(5) NULL,
    [备注] nvarchar(50) NULL,
    [是否入仓] nvarchar(10) NULL,
    [打印次数] real NULL
);

CREATE TABLE [裁床明细表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [裁床单号] nvarchar(10) NULL,
    [生产单号] nvarchar(30) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(50) NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(50) NULL,
    [市场] nvarchar(25) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [日期] datetime NULL,
    [床号] nvarchar(20) NULL,
    [行数] real NULL,
    [列数] real NULL,
    [扎号] real NULL,
    [缸号] nvarchar(40) NULL,
    [颜色] nvarchar(40) NULL,
    [尺码] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [计件数量] decimal(18,4) NULL,
    [备注] nvarchar(50) NULL,
    [有效] nvarchar(6) NULL
);

CREATE INDEX IX_114_单号 ON [裁床明细表]([单号]);

CREATE TABLE [裁床颜色尺码] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [裁床单号] nvarchar(10) NULL,
    [类型] nvarchar(10) NULL,
    [序号] real NULL,
    [名称] nvarchar(25) NULL,
    [缸号] nvarchar(40) NULL,
    [枚数] decimal(18,4) NULL,
    [件数] decimal(18,4) NULL,
    [比例] decimal(18,4) NULL,
    [每扎数量] decimal(18,4) NULL,
    [用料] decimal(18,4) NULL,
    [余料] decimal(18,4) NULL
);

CREATE TABLE [装箱单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [装箱单号] nvarchar(50) NULL,
    [生产单号] nvarchar(50) NULL,
    [装箱日期] datetime NULL,
    [部门编号] nvarchar(12) NULL,
    [部门] nvarchar(40) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(50) NULL,
    [地址] nvarchar(150) NULL,
    [装船日期] datetime NULL,
    [运输方式] nvarchar(30) NULL,
    [目的地] nvarchar(150) NULL,
    [出货地] nvarchar(150) NULL,
    [下货地] nvarchar(150) NULL,
    [船唛] nvarchar(50) NULL,
    [口岸] nvarchar(150) NULL,
    [入口国] nvarchar(80) NULL,
    [备注] nvarchar(150) NULL,
    [审核] nvarchar(2) NULL,
    [操作员] nvarchar(30) NULL,
    [本单数量] decimal(18,4) NULL,
    [装箱数量] decimal(18,4) NULL,
    [箱数] real NULL,
    [毛重] decimal(18,4) NULL,
    [净重] decimal(18,4) NULL,
    [起始箱号] real NULL,
    [结束箱号] real NULL
);

CREATE TABLE [装箱单尺码表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [装箱单号] nvarchar(50) NULL,
    [装箱日期] datetime NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(50) NULL,
    [颜色号] nvarchar(20) NULL,
    [颜色名称] nvarchar(40) NULL,
    [序号] real NULL,
    [尺码1] nvarchar(20) NULL,
    [尺码2] nvarchar(20) NULL,
    [尺码3] nvarchar(20) NULL,
    [尺码4] nvarchar(20) NULL,
    [尺码5] nvarchar(20) NULL,
    [尺码6] nvarchar(20) NULL,
    [尺码7] nvarchar(20) NULL,
    [尺码8] nvarchar(20) NULL,
    [尺码9] nvarchar(20) NULL,
    [尺码10] nvarchar(20) NULL,
    [尺码11] nvarchar(20) NULL,
    [尺码12] nvarchar(20) NULL,
    [尺码13] nvarchar(20) NULL,
    [尺码14] nvarchar(20) NULL,
    [尺码15] nvarchar(20) NULL,
    [尺码16] nvarchar(20) NULL,
    [尺码17] nvarchar(20) NULL,
    [尺码18] nvarchar(20) NULL,
    [尺码19] nvarchar(20) NULL,
    [尺码20] nvarchar(20) NULL,
    [尺码21] nvarchar(20) NULL,
    [尺码22] nvarchar(20) NULL,
    [尺码23] nvarchar(20) NULL,
    [尺码24] nvarchar(20) NULL,
    [尺码25] nvarchar(20) NULL,
    [尺码26] nvarchar(20) NULL,
    [尺码27] nvarchar(20) NULL,
    [尺码28] nvarchar(20) NULL,
    [尺码29] nvarchar(20) NULL,
    [尺码30] nvarchar(20) NULL
);

CREATE TABLE [装箱单明细表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [装箱单号] nvarchar(50) NULL,
    [装箱日期] datetime NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(50) NULL,
    [颜色号] nvarchar(20) NULL,
    [颜色名称] nvarchar(40) NULL,
    [序号] real NULL,
    [箱号] real NULL,
    [毛重] decimal(18,4) NULL,
    [净重] decimal(18,4) NULL,
    [箱规格] nvarchar(60) NULL,
    [备注] nvarchar(100) NULL,
    [尺码1] nvarchar(20) NULL,
    [尺码2] nvarchar(20) NULL,
    [尺码3] nvarchar(20) NULL,
    [尺码4] nvarchar(20) NULL,
    [尺码5] nvarchar(20) NULL,
    [尺码6] nvarchar(20) NULL,
    [尺码7] nvarchar(20) NULL,
    [尺码8] nvarchar(20) NULL,
    [尺码9] nvarchar(20) NULL,
    [尺码10] nvarchar(20) NULL,
    [尺码11] nvarchar(20) NULL,
    [尺码12] nvarchar(20) NULL,
    [尺码13] nvarchar(20) NULL,
    [尺码14] nvarchar(20) NULL,
    [尺码15] nvarchar(20) NULL,
    [尺码16] nvarchar(20) NULL,
    [尺码17] nvarchar(20) NULL,
    [尺码18] nvarchar(20) NULL,
    [尺码19] nvarchar(20) NULL,
    [尺码20] nvarchar(20) NULL,
    [尺码21] nvarchar(20) NULL,
    [尺码22] nvarchar(20) NULL,
    [尺码23] nvarchar(20) NULL,
    [尺码24] nvarchar(20) NULL,
    [尺码25] nvarchar(20) NULL,
    [尺码26] nvarchar(20) NULL,
    [尺码27] nvarchar(20) NULL,
    [尺码28] nvarchar(20) NULL,
    [尺码29] nvarchar(20) NULL,
    [尺码30] nvarchar(20) NULL
);

CREATE INDEX IX_118_单号 ON [装箱单明细表]([单号]);

CREATE TABLE [装箱单款号] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [装箱单号] nvarchar(50) NULL,
    [装箱日期] datetime NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(50) NULL,
    [款式] nvarchar(80) NULL,
    [本单数量] decimal(18,4) NULL,
    [装箱数量] decimal(18,4) NULL,
    [箱数] real NULL,
    [毛重] decimal(18,4) NULL,
    [净重] decimal(18,4) NULL,
    [起始箱号] real NULL,
    [结束箱号] real NULL,
    [备注] nvarchar(150) NULL,
    [箱唛说明] nvarchar(max) NULL,
    [包装说明] nvarchar(max) NULL
);

CREATE TABLE [计件月结] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [月份] nvarchar(20) NULL,
    [成功] nvarchar(6) NULL,
    [内容] nvarchar(40) NULL
);

CREATE TABLE [计件表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [条码号] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [裁床单号] nvarchar(15) NULL,
    [床号] nvarchar(15) NULL,
    [裁床日期] datetime NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(20) NULL,
    [扎号] real NULL,
    [工序号] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [员工号] nvarchar(30) NULL,
    [日期] datetime NULL,
    [原数量] decimal(18,4) NULL,
    [扫描手工] nvarchar(6) NULL,
    [计件类型] nvarchar(6) NULL,
    [计件单位] real NULL,
    [审核] nvarchar(6) NULL,
    [张数] real NULL,
    [有效] nvarchar(6) NULL
);

CREATE TABLE [调价明细表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [性质] nvarchar(16) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [原单价] decimal(18,4) NULL,
    [修改单价] decimal(18,4) NULL,
    [修改原因] nvarchar(150) NULL
);

CREATE INDEX IX_122_单号 ON [调价明细表]([单号]);

CREATE TABLE [调价表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [调拨单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [源仓库] nvarchar(20) NULL,
    [目标仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [调拨明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [源仓库] nvarchar(20) NULL,
    [目标仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [库存数量] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [库存单价] decimal(18,4) NULL,
    [库存金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_125_单号 ON [调拨明细单]([单号]);

CREATE TABLE [资料类别] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [类别] nvarchar(6) NULL,
    [基本资料] nvarchar(20) NULL
);

CREATE TABLE [退料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [生产单号] nvarchar(30) NULL,
    [退料部门] nvarchar(20) NULL,
    [退料人] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [退料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [退料部门] nvarchar(20) NULL,
    [退料人] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [库存单价] decimal(18,4) NULL,
    [库存金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL,
    [预算数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_128_单号 ON [退料明细单]([单号]);

CREATE TABLE [部门信息] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [编号] nvarchar(10) NULL,
    [部门] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL
);

CREATE TABLE [部门工序表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [部门编号] nvarchar(20) NULL,
    [生产单号] nvarchar(50) NULL,
    [工序号] nvarchar(10) NULL,
    [工序名称] nvarchar(50) NULL,
    [单价] decimal(18,4) NULL,
    [工序类型] nvarchar(20) NULL,
    [备注] nvarchar(100) NULL,
    [审核] nvarchar(5) NULL
);

CREATE TABLE [采购付款单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [入仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [采购付款明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [入仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [货款金额] decimal(18,4) NULL,
    [付款金额] decimal(18,4) NULL,
    [尚欠金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_132_单号 ON [采购付款明细单]([单号]);

CREATE TABLE [采购入仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [采购入仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [订单单号] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL,
    [付款方式] nvarchar(10) NULL,
    [预算数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_134_单号 ON [采购入仓明细单]([单号]);

CREATE TABLE [采购明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(30) NULL,
    [款式] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [合同号] nvarchar(30) NULL,
    [日期] datetime2(0) NULL,
    [交货日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL,
    [预算数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [幅宽] nvarchar(40) NULL,
    [克重] nvarchar(40) NULL,
    [色号] nvarchar(40) NULL,
    [厂款号] nvarchar(50) NULL,
    [客款号] nvarchar(50) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_135_单号 ON [采购明细单]([单号]);

CREATE TABLE [采购订单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [交货日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [发件人] nvarchar(20) NULL,
    [收件人] nvarchar(20) NULL,
    [电话] nvarchar(50) NULL,
    [传真] nvarchar(50) NULL,
    [生产单号] nvarchar(50) NULL,
    [厂款号] nvarchar(50) NULL,
    [客款号] nvarchar(50) NULL,
    [交货时间要求] nvarchar(40) NULL,
    [结算方法] nvarchar(90) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [采购退仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [入仓单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [采购退仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [入仓单号] nvarchar(20) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [日期] datetime2(0) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_138_单号 ON [采购退仓明细单]([单号]);

CREATE TABLE [销售出货单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [付款方式] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [销售出货明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [库存单价] decimal(18,4) NULL,
    [库存金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_140_单号 ON [销售出货明细单]([单号]);

CREATE TABLE [销售收款单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [出仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [销售收款明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [出仓单号] nvarchar(20) NULL,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [货款金额] decimal(18,4) NULL,
    [收款金额] decimal(18,4) NULL,
    [应收金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_142_单号 ON [销售收款明细单]([单号]);

CREATE TABLE [销售退货单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [销售单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL
);

CREATE TABLE [销售退货明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [销售单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(40) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [库存单价] decimal(18,4) NULL,
    [库存金额] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL
);

CREATE INDEX IX_144_单号 ON [销售退货明细单]([单号]);

CREATE TABLE [领料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [领料部门] nvarchar(20) NULL,
    [领料人] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(10) NULL,
    [审核] nvarchar(2) NULL,
    [备注] nvarchar(150) NULL,
    [打印次数] int NULL,
    [已阅用户] nvarchar(100) NULL
);

CREATE TABLE [领料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NULL,
    [日期] datetime2(0) NULL,
    [生产单号] nvarchar(30) NULL,
    [款号] nvarchar(40) NULL,
    [合同号] nvarchar(30) NULL,
    [客户款号] nvarchar(30) NULL,
    [领料部门] nvarchar(20) NULL,
    [领料人] nvarchar(10) NULL,
    [仓库] nvarchar(20) NULL,
    [物料类别] nvarchar(20) NULL,
    [条码号] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [批号] nvarchar(40) NULL,
    [规格] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [库存单价] decimal(18,4) NULL,
    [库存金额] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(150) NULL,
    [类型] nvarchar(10) NULL,
    [预算数量] decimal(18,4) NULL,
    [预算单价] decimal(18,4) NULL,
    [打印次数] int NULL
);

CREATE INDEX IX_146_单号 ON [领料明细单]([单号]);
