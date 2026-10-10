/**
 * 位图色彩分析：统计不透明像素的颜色分布，用于客观判断
 * 「小尺寸下品牌特征（尤其深色五官）是否还保留」。
 *
 * 用法：node dominant-colors.js <file.png> [topN]
 */
const { decode } = require('./verify-png.js');

const file = process.argv[2];
const topN = Number(process.argv[3] || 6);
if (!file) { console.error('用法: node dominant-colors.js <file.png> [topN]'); process.exit(2); }

const { ihdr, channels, pixels } = decode(file);
if (channels !== 4) { console.error('需要 RGBA 图像'); process.exit(1); }

const counts = new Map();
let opaque = 0;

for (let i = 0; i < pixels.length; i += 4) {
  const a = pixels[i + 3];
  if (a < 200) continue;          // 只统计「基本不透明」的像素，避免抗锯齿边缘拉偏统计
  opaque++;
  const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
  counts.set(key, (counts.get(key) || 0) + 1);
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0').toUpperCase();
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

console.log(`文件        ${file}  (${ihdr.width}×${ihdr.height})`);
console.log(`不透明像素  ${opaque}`);
console.log('主要颜色：');
for (const [c, n] of sorted.slice(0, topN)) {
  const pct = (n / opaque * 100).toFixed(1);
  console.log(`  ${hex(c)}  ${String(n).padStart(5)}  ${pct.padStart(5)}%  ${'█'.repeat(Math.max(1, Math.round(n / opaque * 40)))}`);
}

// 品牌色命中检查：把每个目标色与画面中最近的颜色做距离比较
const BRAND = {
  '天空蓝 #78BDF5':   [0x78, 0xBD, 0xF5],
  '薰衣草紫 #A99AF7': [0xA9, 0x9A, 0xF7],
  '奶油白 #FFF9F0':   [0xFF, 0xF9, 0xF0],
  '薄荷绿 #9DE4CC':   [0x9D, 0xE4, 0xCC],
  '深蓝灰 #34415E':   [0x34, 0x41, 0x5E],
};

console.log('品牌色命中（画面中是否还存在该颜色的像素）：');
for (const [name, [r, g, b]] of Object.entries(BRAND)) {
  let best = Infinity, bestHex = 0, bestN = 0;
  for (const [c, n] of counts) {
    const cr = (c >> 16) & 0xff, cg = (c >> 8) & 0xff, cb = c & 0xff;
    const d = Math.sqrt((cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2);
    if (d < best) { best = d; bestHex = c; bestN = n; }
  }
  // 距离阈值 30 以内视为「该色仍在画面中可辨」
  const ok = best <= 30 && bestN >= 3;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(20)} 最近像素 ${hex(bestHex)} 距离 ${best.toFixed(1)} 数量 ${bestN}`);
}
