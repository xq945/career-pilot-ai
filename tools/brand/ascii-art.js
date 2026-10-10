/**
 * 位图 → 字符画。把渲染结果转成可读的网格，用于「看到」图形实际长什么样。
 *
 * 每个像素按色彩归类到最近的品牌色，用不同字符表示：
 *   B 天空蓝   P 薰衣草紫   W 奶油白   G 薄荷绿   D 深蓝灰   + 边缘（半透明）
 * 透明像素输出空格。
 *
 * 用法：node ascii-art.js <file.png> [--bg=white|dark]
 */
const { decode } = require('./verify-png.js');

const CATS = [
  { ch: 'B', name: '天空蓝', c: [0x78, 0xBD, 0xF5] },
  { ch: 'P', name: '薰衣草紫', c: [0xA9, 0x9A, 0xF7] },
  { ch: 'W', name: '奶油白', c: [0xFF, 0xF9, 0xF0] },
  { ch: 'G', name: '薄荷绿', c: [0x9D, 0xE4, 0xCC] },
  { ch: 'D', name: '深蓝灰', c: [0x34, 0x41, 0x5E] },
];

const file = process.argv[2];
if (!file) { console.error('用法: node ascii-art.js <file.png>'); process.exit(2); }

const dark = process.argv.includes('--bg=dark');
const BG = dark ? [29, 37, 64] : [255, 255, 255];

const { ihdr, channels, pixels } = decode(file);
const { width: w, height: h } = ihdr;
if (channels !== 4) { console.error('需要 RGBA 图像'); process.exit(1); }

// 每行输出两遍，缓解终端字符长宽比导致的垂直压扁
const rows = [];
for (let y = 0; y < h; y++) {
  let line = '';
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const a = pixels[i + 3] / 255;
    if (a < 0.12) { line += ' '; continue; }
    // 与背景混合后再归类
    const r = pixels[i] * a + BG[0] * (1 - a);
    const g = pixels[i + 1] * a + BG[1] * (1 - a);
    const b = pixels[i + 2] * a + BG[2] * (1 - a);
    if (a < 0.75) { line += '+'; continue; }
    let best = '?', bestD = Infinity;
    for (const cat of CATS) {
      const d = (r - cat.c[0]) ** 2 + (g - cat.c[1]) ** 2 + (b - cat.c[2]) ** 2;
      if (d < bestD) { bestD = d; best = cat.ch; }
    }
    line += best;
  }
  rows.push(line);
}

console.log(`── ${file}  ${w}×${h}  (背景 ${dark ? '深色' : '浅色'}) ──`);
rows.forEach((r) => console.log(r));
console.log('');
console.log('图例: B=天空蓝  P=薰衣草紫  W=奶油白  G=薄荷绿  D=深蓝灰  +=边缘');
