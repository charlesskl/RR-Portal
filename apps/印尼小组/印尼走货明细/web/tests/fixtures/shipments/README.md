# 走货表格隔离回归页

在 `web` 目录安装现有依赖后运行：

```sh
npm exec vite -- --config tests/fixtures/shipments/vite.config.ts
```

打开 `http://127.0.0.1:5196/tests/fixtures/shipments/performance.html`。

这个入口使用真实的 ShipmentsPage 和 ShipmentSheetTable，所有 API GET 都由
本机 Vite 中间件返回合成样本，不使用登录凭据、不连接数据库；所有写请求返回 405。
默认生产构建不引用这个 HTML 或中间件。

检查场景：

- TEST-68-ROWS：68 行、47 列。首次只挂载可见行，非激活单元格不挂载编辑器。
  连续方向键可到第 68 行；跨列后表头和内容对齐；F2 激活编辑；数字离开前提交。
- TEST-LOAD-FAILURE：延迟后返回 503。显示错误和重新加载，保存、导出按钮禁用。
- TEST-SLOW-MATERIALS：详情返回后仍需等待延迟的物料读取，不能操作半加载的资料。
- TEST-MERGED-CARTONS：两个采购来源的同物料合为一行，数量只读；共箱仅计一次，
  方向键跳过隐藏的箱数格。

单元测试还覆盖跨虚拟窗口的整段复制、粘贴、填充，以及关闭/切换后迟到响应的隔离。
