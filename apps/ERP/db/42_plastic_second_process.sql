-- 塑胶二次加工(喷油/电镀/植发/植绒):塑胶加工采购单明细补 加工次序/加工字母 两列。幂等。
-- 加工次序: 第一次/第二次;加工字母: BD类(电镀=B,印喷=D), AF类(印喷=A,植绒=F), AH类(印喷=A,植发=H)。
IF COL_LENGTH(N'塑胶加工采购单明细', N'加工次序') IS NULL
    ALTER TABLE [塑胶加工采购单明细] ADD [加工次序] nvarchar(10) NULL;
IF COL_LENGTH(N'塑胶加工采购单明细', N'加工字母') IS NULL
    ALTER TABLE [塑胶加工采购单明细] ADD [加工字母] nvarchar(4) NULL;
