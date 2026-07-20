# 数据快照说明

- `example-data.json` 是合成测试数据，仅用于验证 schema、外键、图片和幂等导入。
- 真实 `business-data.json` 含业务价格、供应商、用户和图片，已被 `.gitignore` 排除，禁止提交。
- 生产快照应通过受控通道写入服务器 `data/indo-shipping-seed/business-data.json`。

初始化任务只在空数据库且没有 seed marker 时导入真实快照；已有数据时拒绝重建或重复导入。
