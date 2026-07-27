export function appRoot(basePath = process.env.NEXT_PUBLIC_BASE_PATH || "") {
  return basePath ? `${basePath.replace(/\/+$/, "")}/` : "/";
}
