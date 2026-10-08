-- 表间关联脚本(自建新库用)。先建唯一键(主表业务键),再加外键。
-- 注意:需主数据干净(业务键唯一、子表值都能匹配),否则约束会报错。可先建索引、按需启用FK。

-- 1) 主表业务键 唯一约束
ALTER TABLE [人事档案] ADD CONSTRAINT UQ_人事档案_编号 UNIQUE([编号]);
ALTER TABLE [供应商资料] ADD CONSTRAINT UQ_供应商资料_供应商编号 UNIQUE([供应商编号]);
ALTER TABLE [加工厂资料] ADD CONSTRAINT UQ_加工厂资料_加工厂编号 UNIQUE([加工厂编号]);
ALTER TABLE [半成品入仓单] ADD CONSTRAINT UQ_半成品入仓单_单号 UNIQUE([单号]);
ALTER TABLE [半成品盘点单] ADD CONSTRAINT UQ_半成品盘点单_单号 UNIQUE([单号]);
ALTER TABLE [半成品领料单] ADD CONSTRAINT UQ_半成品领料单_单号 UNIQUE([单号]);
ALTER TABLE [发外加工付款单] ADD CONSTRAINT UQ_发外加工付款单_单号 UNIQUE([单号]);
ALTER TABLE [发外加工单] ADD CONSTRAINT UQ_发外加工单_单号 UNIQUE([单号]);
ALTER TABLE [发外回收单] ADD CONSTRAINT UQ_发外回收单_单号 UNIQUE([单号]);
ALTER TABLE [客户资料] ADD CONSTRAINT UQ_客户资料_客户编号 UNIQUE([客户编号]);
ALTER TABLE [成品入仓付款单] ADD CONSTRAINT UQ_成品入仓付款单_单号 UNIQUE([单号]);
ALTER TABLE [成品入仓单] ADD CONSTRAINT UQ_成品入仓单_单号 UNIQUE([单号]);
ALTER TABLE [成品出仓单] ADD CONSTRAINT UQ_成品出仓单_单号 UNIQUE([单号]);
ALTER TABLE [成品客户收款单] ADD CONSTRAINT UQ_成品客户收款单_单号 UNIQUE([单号]);
ALTER TABLE [成品客户订单总表] ADD CONSTRAINT UQ_成品客户订单总表_单号 UNIQUE([单号]);
ALTER TABLE [成品盘点单] ADD CONSTRAINT UQ_成品盘点单_单号 UNIQUE([单号]);
ALTER TABLE [成品调拨单] ADD CONSTRAINT UQ_成品调拨单_单号 UNIQUE([单号]);
ALTER TABLE [成品退仓单] ADD CONSTRAINT UQ_成品退仓单_单号 UNIQUE([单号]);
ALTER TABLE [成品退货单] ADD CONSTRAINT UQ_成品退货单_单号 UNIQUE([单号]);
ALTER TABLE [款号总表] ADD CONSTRAINT UQ_款号总表_款号 UNIQUE([款号]);
ALTER TABLE [物料资料] ADD CONSTRAINT UQ_物料资料_物料编号 UNIQUE([物料编号]);
ALTER TABLE [生产制单] ADD CONSTRAINT UQ_生产制单_生产单号 UNIQUE([生产单号]);
ALTER TABLE [盘点单] ADD CONSTRAINT UQ_盘点单_单号 UNIQUE([单号]);
ALTER TABLE [调拨单] ADD CONSTRAINT UQ_调拨单_单号 UNIQUE([单号]);
ALTER TABLE [退料单] ADD CONSTRAINT UQ_退料单_单号 UNIQUE([单号]);
ALTER TABLE [部门信息] ADD CONSTRAINT UQ_部门信息_编号 UNIQUE([编号]);
ALTER TABLE [采购付款单] ADD CONSTRAINT UQ_采购付款单_单号 UNIQUE([单号]);
ALTER TABLE [采购入仓单] ADD CONSTRAINT UQ_采购入仓单_单号 UNIQUE([单号]);
ALTER TABLE [采购退仓单] ADD CONSTRAINT UQ_采购退仓单_单号 UNIQUE([单号]);
ALTER TABLE [销售出货单] ADD CONSTRAINT UQ_销售出货单_单号 UNIQUE([单号]);
ALTER TABLE [销售收款单] ADD CONSTRAINT UQ_销售收款单_单号 UNIQUE([单号]);
ALTER TABLE [销售退货单] ADD CONSTRAINT UQ_销售退货单_单号 UNIQUE([单号]);
ALTER TABLE [领料单] ADD CONSTRAINT UQ_领料单_单号 UNIQUE([单号]);

-- 2) 外键约束
ALTER TABLE [b缺勤登记明细] ADD CONSTRAINT FK_0_查找 FOREIGN KEY([工号]) REFERENCES [人事档案]([编号]);  -- 查找
ALTER TABLE [人事档案] ADD CONSTRAINT FK_1_查找 FOREIGN KEY([部门编号]) REFERENCES [部门信息]([编号]);  -- 查找
ALTER TABLE [入仓调价表] ADD CONSTRAINT FK_2_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [半成品入仓单] ADD CONSTRAINT FK_3_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [半成品入仓单] ADD CONSTRAINT FK_4_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [半成品入仓单] ADD CONSTRAINT FK_5_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [半成品入仓明细单] ADD CONSTRAINT FK_6_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [半成品入仓明细单] ADD CONSTRAINT FK_7_主从 FOREIGN KEY([单号]) REFERENCES [半成品入仓单]([单号]);  -- 主从
ALTER TABLE [半成品入仓明细单] ADD CONSTRAINT FK_8_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [半成品入仓明细单] ADD CONSTRAINT FK_9_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [半成品入仓明细单] ADD CONSTRAINT FK_10_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [半成品盘点明细单] ADD CONSTRAINT FK_11_主从 FOREIGN KEY([单号]) REFERENCES [半成品盘点单]([单号]);  -- 主从
ALTER TABLE [半成品盘点明细单] ADD CONSTRAINT FK_12_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [半成品盘点明细单] ADD CONSTRAINT FK_13_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [半成品盘点明细单] ADD CONSTRAINT FK_14_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [半成品领料单] ADD CONSTRAINT FK_15_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [半成品领料单] ADD CONSTRAINT FK_16_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [半成品领料单] ADD CONSTRAINT FK_17_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [半成品领料明细单] ADD CONSTRAINT FK_18_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [半成品领料明细单] ADD CONSTRAINT FK_19_主从 FOREIGN KEY([单号]) REFERENCES [半成品领料单]([单号]);  -- 主从
ALTER TABLE [半成品领料明细单] ADD CONSTRAINT FK_20_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [半成品领料明细单] ADD CONSTRAINT FK_21_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [半成品领料明细单] ADD CONSTRAINT FK_22_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [原始记录] ADD CONSTRAINT FK_23_查找 FOREIGN KEY([工号]) REFERENCES [人事档案]([编号]);  -- 查找
ALTER TABLE [发外加工付款明细单] ADD CONSTRAINT FK_24_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外加工付款明细单] ADD CONSTRAINT FK_25_主从 FOREIGN KEY([单号]) REFERENCES [发外加工付款单]([单号]);  -- 主从
ALTER TABLE [发外加工单] ADD CONSTRAINT FK_26_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外加工对数表] ADD CONSTRAINT FK_27_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外加工对数表] ADD CONSTRAINT FK_28_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [发外加工总单] ADD CONSTRAINT FK_29_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外加工总单] ADD CONSTRAINT FK_30_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [发外加工总单] ADD CONSTRAINT FK_31_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [发外加工明细单] ADD CONSTRAINT FK_32_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外加工明细单] ADD CONSTRAINT FK_33_主从 FOREIGN KEY([单号]) REFERENCES [发外加工单]([单号]);  -- 主从
ALTER TABLE [发外加工明细单] ADD CONSTRAINT FK_34_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [发外加工明细单] ADD CONSTRAINT FK_35_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [发外回收单] ADD CONSTRAINT FK_36_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外回收总单] ADD CONSTRAINT FK_37_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外回收总单] ADD CONSTRAINT FK_38_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [发外回收总单] ADD CONSTRAINT FK_39_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [发外回收明细单] ADD CONSTRAINT FK_40_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [发外回收明细单] ADD CONSTRAINT FK_41_主从 FOREIGN KEY([单号]) REFERENCES [发外回收单]([单号]);  -- 主从
ALTER TABLE [发外回收明细单] ADD CONSTRAINT FK_42_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [发外回收明细单] ADD CONSTRAINT FK_43_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [头办单] ADD CONSTRAINT FK_44_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [头办单] ADD CONSTRAINT FK_45_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [头办单图片] ADD CONSTRAINT FK_46_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [头办单尺码表] ADD CONSTRAINT FK_47_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [委托发外加工单] ADD CONSTRAINT FK_48_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [委托发外加工单] ADD CONSTRAINT FK_49_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [委托发外加工单] ADD CONSTRAINT FK_50_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [工票格式] ADD CONSTRAINT FK_51_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [工票裁片] ADD CONSTRAINT FK_52_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [工资总表] ADD CONSTRAINT FK_53_查找 FOREIGN KEY([部门编号]) REFERENCES [部门信息]([编号]);  -- 查找
ALTER TABLE [工资明细表] ADD CONSTRAINT FK_54_查找 FOREIGN KEY([部门编号]) REFERENCES [部门信息]([编号]);  -- 查找
ALTER TABLE [工资模板公式] ADD CONSTRAINT FK_55_查找 FOREIGN KEY([部门编号]) REFERENCES [部门信息]([编号]);  -- 查找
ALTER TABLE [工资表项目公式] ADD CONSTRAINT FK_56_查找 FOREIGN KEY([部门编号]) REFERENCES [部门信息]([编号]);  -- 查找
ALTER TABLE [成品入仓付款明细单] ADD CONSTRAINT FK_57_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [成品入仓付款明细单] ADD CONSTRAINT FK_58_主从 FOREIGN KEY([单号]) REFERENCES [成品入仓付款单]([单号]);  -- 主从
ALTER TABLE [成品入仓单] ADD CONSTRAINT FK_59_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [成品入仓总单] ADD CONSTRAINT FK_60_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [成品入仓总单] ADD CONSTRAINT FK_61_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品入仓总单] ADD CONSTRAINT FK_62_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品入仓明细单] ADD CONSTRAINT FK_63_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [成品入仓明细单] ADD CONSTRAINT FK_64_主从 FOREIGN KEY([单号]) REFERENCES [成品入仓单]([单号]);  -- 主从
ALTER TABLE [成品入仓明细单] ADD CONSTRAINT FK_65_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品入仓明细单] ADD CONSTRAINT FK_66_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品出仓单] ADD CONSTRAINT FK_67_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品出仓总单] ADD CONSTRAINT FK_68_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品出仓总单] ADD CONSTRAINT FK_69_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品出仓总单] ADD CONSTRAINT FK_70_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品出仓明细单] ADD CONSTRAINT FK_71_主从 FOREIGN KEY([单号]) REFERENCES [成品出仓单]([单号]);  -- 主从
ALTER TABLE [成品出仓明细单] ADD CONSTRAINT FK_72_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品出仓明细单] ADD CONSTRAINT FK_73_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品出仓明细单] ADD CONSTRAINT FK_74_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品客户收款明细单] ADD CONSTRAINT FK_75_主从 FOREIGN KEY([单号]) REFERENCES [成品客户收款单]([单号]);  -- 主从
ALTER TABLE [成品客户收款明细单] ADD CONSTRAINT FK_76_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品客户订单总表] ADD CONSTRAINT FK_77_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品客户订单总表] ADD CONSTRAINT FK_78_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品客户订单总表] ADD CONSTRAINT FK_79_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品客户订单明细表] ADD CONSTRAINT FK_80_主从 FOREIGN KEY([单号]) REFERENCES [成品客户订单总表]([单号]);  -- 主从
ALTER TABLE [成品客户订单明细表] ADD CONSTRAINT FK_81_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品客户订单明细表] ADD CONSTRAINT FK_82_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品客户订单明细表] ADD CONSTRAINT FK_83_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品客户订货单] ADD CONSTRAINT FK_84_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品盘点单] ADD CONSTRAINT FK_85_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品盘点总单] ADD CONSTRAINT FK_86_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品盘点总单] ADD CONSTRAINT FK_87_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品盘点总单] ADD CONSTRAINT FK_88_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品盘点明细单] ADD CONSTRAINT FK_89_主从 FOREIGN KEY([单号]) REFERENCES [成品盘点单]([单号]);  -- 主从
ALTER TABLE [成品盘点明细单] ADD CONSTRAINT FK_90_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品盘点明细单] ADD CONSTRAINT FK_91_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品盘点明细单] ADD CONSTRAINT FK_92_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品调拨单] ADD CONSTRAINT FK_93_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品调拨总单] ADD CONSTRAINT FK_94_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品调拨总单] ADD CONSTRAINT FK_95_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品调拨总单] ADD CONSTRAINT FK_96_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品调拨明细单] ADD CONSTRAINT FK_97_主从 FOREIGN KEY([单号]) REFERENCES [成品调拨单]([单号]);  -- 主从
ALTER TABLE [成品调拨明细单] ADD CONSTRAINT FK_98_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品调拨明细单] ADD CONSTRAINT FK_99_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品调拨明细单] ADD CONSTRAINT FK_100_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品退仓单] ADD CONSTRAINT FK_101_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [成品退仓总单] ADD CONSTRAINT FK_102_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [成品退仓总单] ADD CONSTRAINT FK_103_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品退仓总单] ADD CONSTRAINT FK_104_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品退仓明细单] ADD CONSTRAINT FK_105_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [成品退仓明细单] ADD CONSTRAINT FK_106_主从 FOREIGN KEY([单号]) REFERENCES [成品退仓单]([单号]);  -- 主从
ALTER TABLE [成品退仓明细单] ADD CONSTRAINT FK_107_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品退仓明细单] ADD CONSTRAINT FK_108_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品退货单] ADD CONSTRAINT FK_109_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品退货总单] ADD CONSTRAINT FK_110_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品退货总单] ADD CONSTRAINT FK_111_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品退货总单] ADD CONSTRAINT FK_112_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成品退货明细单] ADD CONSTRAINT FK_113_主从 FOREIGN KEY([单号]) REFERENCES [成品退货单]([单号]);  -- 主从
ALTER TABLE [成品退货明细单] ADD CONSTRAINT FK_114_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [成品退货明细单] ADD CONSTRAINT FK_115_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成品退货明细单] ADD CONSTRAINT FK_116_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [成衣冚检表] ADD CONSTRAINT FK_117_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [成衣冚检表] ADD CONSTRAINT FK_118_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [报价资料] ADD CONSTRAINT FK_119_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [排班表] ADD CONSTRAINT FK_120_查找 FOREIGN KEY([工号]) REFERENCES [人事档案]([编号]);  -- 查找
ALTER TABLE [日报表] ADD CONSTRAINT FK_121_查找 FOREIGN KEY([工号]) REFERENCES [人事档案]([编号]);  -- 查找
ALTER TABLE [日报表签卡登记] ADD CONSTRAINT FK_122_查找 FOREIGN KEY([工号]) REFERENCES [人事档案]([编号]);  -- 查找
ALTER TABLE [款号尺码表] ADD CONSTRAINT FK_123_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [款号明细表] ADD CONSTRAINT FK_124_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [款号物料台头] ADD CONSTRAINT FK_125_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [款号物料图片] ADD CONSTRAINT FK_126_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [款号物料尺寸表] ADD CONSTRAINT FK_127_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [款号物料尺寸表] ADD CONSTRAINT FK_128_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [款号物料总表] ADD CONSTRAINT FK_129_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [款号物料总表] ADD CONSTRAINT FK_130_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [款号物料明细表] ADD CONSTRAINT FK_131_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [款号物料明细表] ADD CONSTRAINT FK_132_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
-- FK_133_查找 已废弃:BOM 为混合物料(来料+塑胶),外键改为应用层校验(StyleService.ReplaceMaterialsAsync 校验两档案),见 db/68
ALTER TABLE [款号颜色表] ADD CONSTRAINT FK_134_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [物料资料] ADD CONSTRAINT FK_135_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [物料资料] ADD CONSTRAINT FK_136_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [物料资料] ADD CONSTRAINT FK_137_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产BOM物料清单] ADD CONSTRAINT FK_138_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [生产BOM物料清单] ADD CONSTRAINT FK_139_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
-- FK_140_查找 同 FK_133 已废弃(生产BOM物料清单为 BOM 展开快照,同样允许混合物料),见 db/68
ALTER TABLE [生产BOM物料清单] ADD CONSTRAINT FK_141_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产制单] ADD CONSTRAINT FK_142_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [生产制单] ADD CONSTRAINT FK_143_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [生产制单] ADD CONSTRAINT FK_144_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单图片] ADD CONSTRAINT FK_145_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单图片] ADD CONSTRAINT FK_146_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产制单尺寸] ADD CONSTRAINT FK_147_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单尺寸] ADD CONSTRAINT FK_148_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产制单尺码表] ADD CONSTRAINT FK_149_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单尺码表] ADD CONSTRAINT FK_150_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产制单工序表] ADD CONSTRAINT FK_151_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单工序表] ADD CONSTRAINT FK_152_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产制单数量] ADD CONSTRAINT FK_153_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [生产制单数量] ADD CONSTRAINT FK_154_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [生产制单数量] ADD CONSTRAINT FK_155_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单数量] ADD CONSTRAINT FK_156_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产制单物料台头] ADD CONSTRAINT FK_157_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单物料台头] ADD CONSTRAINT FK_158_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [生产制单物料清单] ADD CONSTRAINT FK_159_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [生产制单物料清单] ADD CONSTRAINT FK_160_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [生产制单物料清单] ADD CONSTRAINT FK_161_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [盘点明细单] ADD CONSTRAINT FK_162_主从 FOREIGN KEY([单号]) REFERENCES [盘点单]([单号]);  -- 主从
ALTER TABLE [盘点明细单] ADD CONSTRAINT FK_163_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [裁床工资] ADD CONSTRAINT FK_164_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [裁床工资] ADD CONSTRAINT FK_165_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [裁床总表] ADD CONSTRAINT FK_166_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [裁床总表] ADD CONSTRAINT FK_167_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [裁床总表] ADD CONSTRAINT FK_168_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [裁床总表] ADD CONSTRAINT FK_169_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [裁床明细表] ADD CONSTRAINT FK_170_查找 FOREIGN KEY([加工厂编号]) REFERENCES [加工厂资料]([加工厂编号]);  -- 查找
ALTER TABLE [裁床明细表] ADD CONSTRAINT FK_171_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [裁床明细表] ADD CONSTRAINT FK_172_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [裁床明细表] ADD CONSTRAINT FK_173_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [装箱单] ADD CONSTRAINT FK_174_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [装箱单] ADD CONSTRAINT FK_175_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [装箱单] ADD CONSTRAINT FK_176_查找 FOREIGN KEY([部门编号]) REFERENCES [部门信息]([编号]);  -- 查找
ALTER TABLE [装箱单尺码表] ADD CONSTRAINT FK_177_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [装箱单尺码表] ADD CONSTRAINT FK_178_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [装箱单明细表] ADD CONSTRAINT FK_179_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [装箱单明细表] ADD CONSTRAINT FK_180_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [装箱单款号] ADD CONSTRAINT FK_181_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [装箱单款号] ADD CONSTRAINT FK_182_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [计件表] ADD CONSTRAINT FK_183_查找 FOREIGN KEY([员工号]) REFERENCES [人事档案]([编号]);  -- 查找
ALTER TABLE [计件表] ADD CONSTRAINT FK_184_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [调价明细表] ADD CONSTRAINT FK_185_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [调拨明细单] ADD CONSTRAINT FK_186_主从 FOREIGN KEY([单号]) REFERENCES [调拨单]([单号]);  -- 主从
ALTER TABLE [调拨明细单] ADD CONSTRAINT FK_187_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [退料单] ADD CONSTRAINT FK_188_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [退料明细单] ADD CONSTRAINT FK_189_主从 FOREIGN KEY([单号]) REFERENCES [退料单]([单号]);  -- 主从
ALTER TABLE [退料明细单] ADD CONSTRAINT FK_190_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [退料明细单] ADD CONSTRAINT FK_191_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [退料明细单] ADD CONSTRAINT FK_192_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [部门工序表] ADD CONSTRAINT FK_193_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [部门工序表] ADD CONSTRAINT FK_194_查找 FOREIGN KEY([部门编号]) REFERENCES [部门信息]([编号]);  -- 查找
ALTER TABLE [采购付款明细单] ADD CONSTRAINT FK_195_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [采购付款明细单] ADD CONSTRAINT FK_196_主从 FOREIGN KEY([单号]) REFERENCES [采购付款单]([单号]);  -- 主从
ALTER TABLE [采购入仓单] ADD CONSTRAINT FK_197_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [采购入仓单] ADD CONSTRAINT FK_198_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [采购入仓单] ADD CONSTRAINT FK_199_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [采购入仓明细单] ADD CONSTRAINT FK_200_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [采购入仓明细单] ADD CONSTRAINT FK_201_主从 FOREIGN KEY([单号]) REFERENCES [采购入仓单]([单号]);  -- 主从
ALTER TABLE [采购入仓明细单] ADD CONSTRAINT FK_202_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [采购入仓明细单] ADD CONSTRAINT FK_203_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [采购入仓明细单] ADD CONSTRAINT FK_204_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [采购明细单] ADD CONSTRAINT FK_205_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [采购明细单] ADD CONSTRAINT FK_206_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [采购明细单] ADD CONSTRAINT FK_207_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [采购明细单] ADD CONSTRAINT FK_208_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [采购订单] ADD CONSTRAINT FK_209_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [采购订单] ADD CONSTRAINT FK_210_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [采购退仓单] ADD CONSTRAINT FK_211_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [采购退仓明细单] ADD CONSTRAINT FK_212_查找 FOREIGN KEY([供应商编号]) REFERENCES [供应商资料]([供应商编号]);  -- 查找
ALTER TABLE [采购退仓明细单] ADD CONSTRAINT FK_213_主从 FOREIGN KEY([单号]) REFERENCES [采购退仓单]([单号]);  -- 主从
ALTER TABLE [采购退仓明细单] ADD CONSTRAINT FK_214_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [采购退仓明细单] ADD CONSTRAINT FK_215_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [采购退仓明细单] ADD CONSTRAINT FK_216_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [销售出货单] ADD CONSTRAINT FK_217_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [销售出货明细单] ADD CONSTRAINT FK_218_主从 FOREIGN KEY([单号]) REFERENCES [销售出货单]([单号]);  -- 主从
ALTER TABLE [销售出货明细单] ADD CONSTRAINT FK_219_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [销售出货明细单] ADD CONSTRAINT FK_220_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [销售收款明细单] ADD CONSTRAINT FK_221_主从 FOREIGN KEY([单号]) REFERENCES [销售收款单]([单号]);  -- 主从
ALTER TABLE [销售收款明细单] ADD CONSTRAINT FK_222_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [销售退货单] ADD CONSTRAINT FK_223_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [销售退货明细单] ADD CONSTRAINT FK_224_主从 FOREIGN KEY([单号]) REFERENCES [销售退货单]([单号]);  -- 主从
ALTER TABLE [销售退货明细单] ADD CONSTRAINT FK_225_查找 FOREIGN KEY([客户编号]) REFERENCES [客户资料]([客户编号]);  -- 查找
ALTER TABLE [销售退货明细单] ADD CONSTRAINT FK_226_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [领料单] ADD CONSTRAINT FK_227_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [领料单] ADD CONSTRAINT FK_228_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找
ALTER TABLE [领料明细单] ADD CONSTRAINT FK_229_主从 FOREIGN KEY([单号]) REFERENCES [领料单]([单号]);  -- 主从
ALTER TABLE [领料明细单] ADD CONSTRAINT FK_230_查找 FOREIGN KEY([款号]) REFERENCES [款号总表]([款号]);  -- 查找
ALTER TABLE [领料明细单] ADD CONSTRAINT FK_231_查找 FOREIGN KEY([物料编号]) REFERENCES [物料资料]([物料编号]);  -- 查找
ALTER TABLE [领料明细单] ADD CONSTRAINT FK_232_查找 FOREIGN KEY([生产单号]) REFERENCES [生产制单]([生产单号]);  -- 查找