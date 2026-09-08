# ToyQMS macOS 本地版

当前发布版本：Version `0.3.9`，Build `21`，Apple Silicon。

本地版使用原生 WKWebView 和应用内静态服务器运行 ToyQMS，不依赖终端、Node.js 或外部网络。

- 固定应用内地址：`http://127.0.0.1:43127`
- 数据位置：macOS WebKit 本地存储（应用标识 `com.toyqms.desktop`）
- 关闭应用不会清除数据
- 系统设置提供 JSON 数据备份与恢复
- 同一时间只运行一个 ToyQMS 实例

浏览器版数据迁移：先在浏览器版“系统设置”导出本地数据，再在桌面版“系统设置”恢复该 JSON 文件。
