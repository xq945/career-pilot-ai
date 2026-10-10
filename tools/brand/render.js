/**
 * SVG → PNG 渲染器（基于无头 Chrome 真实渲染）
 *
 * 本机没有 ImageMagick / Inkscape / rsvg / sharp / Pillow，
 * 因此走无头浏览器：Chrome 本身就是一个完整的 SVG 渲染引擎，
 * 用 --default-background-color=00000000 拿到真正的透明背景。
 *
 * 用法：
 *   node render.js <input.svg> <output.png> <size>            单个
 *   node render.js <input.svg> <out-prefix> <size1,size2,...> 批量（输出 out-prefix-<size>.png）
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 可用 CHROME_PATH 环境变量指定；否则依次尝试下列位置
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('未找到 Chrome 或 Edge，可用环境变量 CHROME_PATH 指定路径');
}

function toFileUrl(p) {
  return 'file:///' + path.resolve(p).replace(/\\/g, '/');
}

function renderOne(browser, svgPath, outPath, w, h, workDir) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  img{display:block;width:${w}px;height:${h}px}
</style></head>
<body><img src="${toFileUrl(svgPath)}"></body></html>`;

  const tmpHtml = path.join(workDir, `.render-${w}x${h}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--default-background-color=00000000',
    '--force-device-scale-factor=1',
    `--screenshot=${path.resolve(outPath)}`,
    `--window-size=${w},${h}`,
    toFileUrl(tmpHtml),
  ], { stdio: 'pipe' });

  fs.unlinkSync(tmpHtml);

  const stat = fs.statSync(outPath);
  return stat.size;
}

const [svgPath, outArg, sizeArg] = process.argv.slice(2);
if (!svgPath || !outArg || !sizeArg) {
  console.error('用法: node render.js <input.svg> <output.png 或 前缀> <尺寸 或 逗号分隔的多个尺寸>');
  console.error('  尺寸写法: 512 表示 512×512；700x264 表示宽 700 高 264');
  process.exit(2);
}

const browser = findBrowser();
const workDir = path.dirname(path.resolve(svgPath));
const sizes = sizeArg.split(',').map((s) => {
  const t = s.trim();
  const m = t.match(/^(\d+)\s*x\s*(\d+)$/i);
  return m ? { w: Number(m[1]), h: Number(m[2]), tag: `${m[1]}x${m[2]}` }
           : { w: Number(t), h: Number(t), tag: t };
});

for (const s of sizes) {
  // 传完整文件名（以 .png 结尾）就用它，否则视为前缀并附上尺寸
  const outPath = /\.png$/i.test(outArg) ? outArg : `${outArg}-${s.tag}.png`;
  const bytes = renderOne(browser, svgPath, outPath, s.w, s.h, workDir);
  console.log(`  ${s.tag.padStart(9)}  →  ${path.basename(outPath)}  (${bytes} 字节)`);
}
