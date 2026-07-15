import PocketBase from 'pocketbase'

// 本地开发指向 8090；生产由 Nginx 反代到同源 /，此时用相对地址
// 本项目开发端口用 8091，避开「贴纸机系统管理」占用的 8090
// 用访问页面时的主机名拼后端地址：本机开发用 localhost，其他电脑用局域网 IP 都能自动指向正确后端
const baseUrl = import.meta.env.DEV ? `http://${window.location.hostname}:8091` : '/'
export const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)
