#!/usr/bin/env node
/**
 * Build a portable distribution folder that runs on any Windows PC without Node.js.
 *
 * Usage: node scripts/build-portable.js
 *
 * Output: dist-portable/
 *   ├── node.exe          (portable Node.js binary)
 *   ├── server.cjs        (bundled server, single file)
 *   ├── client/dist/      (built frontend)
 *   ├── node_modules/pdfjs-dist/  (pdf worker + fonts)
 *   └── TOMY排期核对.bat   (launcher: starts server + opens browser)
 */

const { execSync } = require('child_process')
const { mkdirSync, rmSync, writeFileSync, existsSync, copyFileSync } = require('fs')
const { resolve, join } = require('path')

const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist-portable')
const NODE_VERSION = 'v22.16.0'

function run(cmd, cwd) {
  cwd = cwd || ROOT
  console.log(`> ${cmd}`)
  const result = require('child_process').spawnSync(cmd, {
    cwd,
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) {
    console.log(`  (exited with code ${result.status}, continuing...)`)
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

try {

// Step 1: Clean
console.log('\n=== Step 1: Clean dist-portable ===')
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true, force: true })
}
ensureDir(DIST)

// Step 2: Build frontend
console.log('\n=== Step 2: Build frontend ===')
run('npm run build', join(ROOT, 'client'))
console.log('  build command finished')
run(`xcopy "${join(ROOT, 'client', 'dist')}" "${join(DIST, 'client', 'dist')}" /E /I /Y /Q`)
console.log('  ✓ client/dist copied')

// Step 3: Bundle server with esbuild
console.log('\n=== Step 3: Bundle server ===')
// Ensure debug/src/browser.js stub exists (debug@4.4.x ships without it)
const debugBrowser = join(ROOT, 'node_modules/debug/src/browser.js')
if (!existsSync(debugBrowser)) {
  writeFileSync(debugBrowser, 'module.exports = {};', 'utf-8')
  console.log('  ✓ Created debug/src/browser.js stub')
}

const esbuild = require('esbuild')
esbuild.buildSync({
  entryPoints: [join(ROOT, 'server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(DIST, 'server.cjs'),
  external: ['pdfjs-dist'],
  target: 'node22',
  mainFields: ['module', 'main'],
  define: {
    'import.meta.url': '__IMPORT_META_URL__',
    'import.meta.dirname': '__dirname',
    'import.meta.filename': '__filename',
  },
  banner: {
    js: [
      `const __IMPORT_META_URL__=require('url').pathToFileURL(__filename).href;`,
      // Polyfill browser APIs needed by pdfjs-dist in Node.js
      `if(typeof globalThis.DOMMatrix==='undefined'){globalThis.DOMMatrix=class DOMMatrix{constructor(){this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0}inverse(){return new DOMMatrix()}multiply(){return new DOMMatrix()}translate(){return new DOMMatrix()}scale(){return new DOMMatrix()}transformPoint(p){return p}}}`,
      `if(typeof globalThis.ImageData==='undefined'){globalThis.ImageData=class ImageData{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4)}}}`,
      `if(typeof globalThis.Path2D==='undefined'){globalThis.Path2D=class Path2D{constructor(){}}}`,
    ].join('\n'),
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
run(`xcopy "${join(pdfjsSrc, 'standard_fonts')}" "${join(DIST, 'node_modules', 'pdfjs-dist', 'standard_fonts')}" /E /I /Y /Q`)
copyFileSync(
  join(pdfjsSrc, 'package.json'),
  join(DIST, 'node_modules/pdfjs-dist/package.json')
)
console.log('  ✓ pdfjs-dist assets copied')

// Step 5: Get portable Node.js
console.log('\n=== Step 5: Get Node.js binary ===')
const nodeExe = join(DIST, 'node.exe')
if (!existsSync(nodeExe)) {
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
const batContent = `@echo off\r
cd /d "%~dp0"\r
set NODE_ENV=production\r
title TOMY Schedule Checker\r
echo.\r
echo   Starting server on http://localhost:3000\r
echo.\r
start /b cmd /c "ping -n 4 127.0.0.1 >nul && start http://localhost:3000"\r
node.exe --max-old-space-size=2048 start.js\r
echo.\r
echo   Server stopped.\r
pause\r
`
writeFileSync(join(DIST, 'TOMY排期核对.bat'), batContent, 'utf-8')
// Create start.js wrapper (node exits when running CJS bundle directly, require() keeps it alive)
writeFileSync(join(DIST, 'start.js'), "require('./server.cjs');\n", 'utf-8')
console.log('  ✓ TOMY排期核对.bat + start.js created')

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

} catch (err) {
  console.error('\n=== BUILD FAILED ===')
  console.error(err)
  process.exit(1)
}
