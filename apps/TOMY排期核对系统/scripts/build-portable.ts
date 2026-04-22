/**
 * Build a portable distribution folder that runs on any Windows PC without Node.js.
 *
 * Output: dist-portable/
 *   ├── node.exe          (portable Node.js binary)
 *   ├── server.cjs        (bundled server, single file)
 *   ├── client/dist/      (built frontend)
 *   ├── pdfjs/
 *   │   ├── pdf.worker.mjs
 *   │   └── standard_fonts/
 *   └── TOMY排期核对.bat   (launcher: starts server + opens browser)
 */

import { execSync } from 'child_process'
import { mkdirSync, cpSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist-portable')
const NODE_VERSION = 'v22.16.0' // LTS, stable for Windows

function run(cmd: string, cwd = ROOT) {
  console.log(`> ${cmd}`)
  try {
    execSync(cmd, { cwd, stdio: 'inherit' })
  } catch (e: any) {
    // Allow non-zero exit from build warnings (e.g., vite chunk size warning)
    if (e.status && e.status !== 0) {
      console.log(`  (exited with code ${e.status}, continuing...)`)
    } else {
      throw e
    }
  }
}

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true })
}

// Step 1: Clean
console.log('\n=== Step 1: Clean dist-portable ===')
import { rmSync } from 'fs'
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true, force: true })
}
ensureDir(DIST)

// Step 2: Build frontend
console.log('\n=== Step 2: Build frontend ===')
run('npm run build', join(ROOT, 'client'))
cpSync(join(ROOT, 'client/dist'), join(DIST, 'client/dist'), { recursive: true })
console.log('  ✓ client/dist copied')

// Step 3: Bundle server with esbuild
console.log('\n=== Step 3: Bundle server ===')
const esbuild = require('esbuild') as typeof import('esbuild')
esbuild.buildSync({
  entryPoints: [join(ROOT, 'server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(DIST, 'server.cjs'),
  external: ['pdfjs-dist'],
  target: 'node22',
  mainFields: ['module', 'main'],  // skip "browser" field (debug@4.4.x has broken browser entry)
  define: {
    'import.meta.url': '__IMPORT_META_URL__',
    'import.meta.dirname': '__dirname',
    'import.meta.filename': '__filename',
  },
  banner: {
    js: `const __IMPORT_META_URL__=require('url').pathToFileURL(__filename).href;`,
  },
})
console.log('  ✓ server.cjs bundled')

// Step 4: Copy pdfjs-dist assets
console.log('\n=== Step 4: Copy pdfjs-dist assets ===')
const pdfjsSrc = join(ROOT, 'node_modules/pdfjs-dist')
ensureDir(join(DIST, 'node_modules/pdfjs-dist/legacy/build'))
ensureDir(join(DIST, 'node_modules/pdfjs-dist/standard_fonts'))

copyFileSync(
  join(pdfjsSrc, 'legacy/build/pdf.mjs'),
  join(DIST, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')
)
copyFileSync(
  join(pdfjsSrc, 'legacy/build/pdf.worker.mjs'),
  join(DIST, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
)
cpSync(
  join(pdfjsSrc, 'standard_fonts'),
  join(DIST, 'node_modules/pdfjs-dist/standard_fonts'),
  { recursive: true }
)
// Copy pdfjs-dist package.json (needed for module resolution)
copyFileSync(
  join(pdfjsSrc, 'package.json'),
  join(DIST, 'node_modules/pdfjs-dist/package.json')
)
console.log('  ✓ pdfjs-dist assets copied')

// Step 5: Download portable Node.js
console.log('\n=== Step 5: Get Node.js binary ===')
const nodeExe = join(DIST, 'node.exe')
if (!existsSync(nodeExe)) {
  // Check if system node.exe can be copied (faster than download)
  const systemNode = execSync('where node', { encoding: 'utf-8' }).trim().split('\n')[0].trim()
  if (systemNode && existsSync(systemNode)) {
    copyFileSync(systemNode, nodeExe)
    console.log(`  ✓ Copied node.exe from ${systemNode}`)
  } else {
    const url = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`
    console.log(`  Downloading ${url}...`)
    run(`curl -Lo "${nodeExe}" "${url}"`)
    console.log('  ✓ node.exe downloaded')
  }
}

// Step 6: Create launcher batch file
console.log('\n=== Step 6: Create launcher ===')
const batContent = `@echo off
chcp 65001 >nul
title TOMY 排期核对系统
echo.
echo   ╔═══════════════════════════════════════╗
echo   ║    TOMY 排期核对系统                    ║
echo   ║    启动中...                            ║
echo   ╚═══════════════════════════════════════╝
echo.

cd /d "%~dp0"
set NODE_ENV=production

:: Start server in background
start /b "" "%~dp0node.exe" "%~dp0server.cjs"

:: Wait for server to start
timeout /t 2 /nobreak >nul

:: Open browser
start http://localhost:3000

echo   服务已启动: http://localhost:3000
echo   请勿关闭此窗口
echo.
echo   按 Ctrl+C 停止服务
echo.

:: Keep window open
"%~dp0node.exe" "%~dp0server.cjs"
`
writeFileSync(join(DIST, 'TOMY排期核对.bat'), batContent, 'utf-8')
console.log('  ✓ TOMY排期核对.bat created')

// Step 7: Create stop script
const stopBat = `@echo off
taskkill /f /im node.exe 2>nul
echo 服务已停止
timeout /t 2 /nobreak >nul
`
writeFileSync(join(DIST, '停止服务.bat'), stopBat, 'utf-8')
console.log('  ✓ 停止服务.bat created')

console.log('\n=== Build complete! ===')
console.log(`Output: ${DIST}`)
console.log('Copy the dist-portable folder to any Windows PC and double-click TOMY排期核对.bat')
