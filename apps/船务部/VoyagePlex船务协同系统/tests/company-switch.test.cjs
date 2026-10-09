const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../components/app-shell.tsx"), "utf8");
const switchStart = source.indexOf('className="company-switch"');
const handlerStart = source.indexOf("onChange={", switchStart) + "onChange={".length;
const handlerEnd = source.indexOf("}>{(user.role", handlerStart);
assert.ok(switchStart >= 0 && handlerEnd > handlerStart, "必须找到实际厂区切换处理函数");
const handler = source.slice(handlerStart, handlerEnd);
for (const prefix of ["", "/voyageplex", "/apps/shipping/voyageplex"]) {
  for (const company of ["Xingxin", "Huadeng"]) {
    let destination;
    const document = { cookie: "" };
    const context = { document, URL, process: {env: {NEXT_PUBLIC_BASE_PATH: prefix}},
      window: {location: {href: `https://portal.example${prefix}/shipments/39`,
        assign(url) {destination = url;}}} };
    vm.runInNewContext(`(${handler})({target:{value:"${company}"}})`, context);
    assert.equal(destination, `https://portal.example${prefix}/`);
    assert.equal(document.cookie, `voyageplex_company=${company}; Path=/; SameSite=Lax`);
    assert.ok(!handler.includes("logout"), "切换厂区不能调用退出登录");
  }
}
console.log("厂区切换：本地和云端路径前缀、双向切换及保留登录验证通过。");
