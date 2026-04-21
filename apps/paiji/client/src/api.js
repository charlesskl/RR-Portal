// nginx 子路径部署 (vite --base /paiji/) 工具:
// - axios 调用通过 main.jsx 的 interceptor 自动加前缀
// - window.open / 其他绕过 axios 的场景用这个 helper
const BASE_PREFIX = import.meta.env.BASE_URL.replace(/\/$/, '');

export function apiUrl(path) {
  if (!path.startsWith('/')) path = '/' + path;
  return BASE_PREFIX + path;
}
