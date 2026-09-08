// Dev launcher that adapts generic CLI flags (e.g. `--host`) to Next.js flags.
// Kimi Work preview starts `npm run dev -- --host localhost --port <n>`;
// `next dev` only understands `--hostname`, so we translate before spawning.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const raw = process.argv.slice(2);
const mapped = [];
for (const a of raw) {
  if (a === "--host") mapped.push("--hostname");
  else if (a.startsWith("--host=")) mapped.push("--hostname=" + a.slice("--host=".length));
  else mapped.push(a);
}

const child = spawn(process.execPath, [nextBin, "dev", ...mapped], {
  stdio: "inherit",
  cwd: root,
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
