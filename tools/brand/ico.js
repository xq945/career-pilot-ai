/**
 * ICO 打包与验证。
 *
 * ICO 是一个公开的容器格式：6 字节文件头 + 每张图 16 字节的目录项 + 各图像的原始数据。
 * 现代 Windows（Vista 及以上）允许目录项直接嵌入 PNG 数据，
 * 因此这里把真实渲染出的 PNG 原样封装进去 —— 生成的是真 ICO，不是改扩展名。
 *
 * 用法：
 *   node ico.js pack <输出.ico> <输入1.png> <输入2.png> ...
 *   node ico.js verify <文件.ico>
 */
const fs = require('fs');
const path = require('path');

function pngSize(buf) {
  // PNG 签名后紧跟 IHDR：偏移 16 起为宽度、20 起为高度（大端）
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 数据');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function pack(outFile, inputs) {
  const images = inputs.map((f) => {
    const data = fs.readFileSync(f);
    const { w, h } = pngSize(data);
    if (w !== h) throw new Error(`${path.basename(f)} 不是正方形，ICO 要求正方形图像`);
    return { data, w, h, file: path.basename(f) };
  }).sort((a, b) => a.w - b.w);   // 按尺寸升序，符合惯例

  const count = images.length;
  const headerSize = 6 + count * 16;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type = 1 (ICO)
  header.writeUInt16LE(count, 4);

  let offset = headerSize;
  const entries = [];
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.w >= 256 ? 0 : img.w;   // 0 表示 256
    e[1] = img.h >= 256 ? 0 : img.h;
    e[2] = 0;                          // 调色板数
    e[3] = 0;                          // reserved
    e.writeUInt16LE(1, 4);             // 颜色平面
    e.writeUInt16LE(32, 6);            // 位深
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.data.length;
  }

  fs.writeFileSync(outFile, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));

  console.log(`已生成 ${path.basename(outFile)}（${fs.statSync(outFile).size} 字节）`);
  for (const img of images) {
    console.log(`  ${String(img.w).padStart(4)}×${String(img.h).padEnd(4)}  ← ${img.file}  (${img.data.length} 字节)`);
  }
}

function verify(file) {
  const buf = fs.readFileSync(file);
  const reserved = buf.readUInt16LE(0);
  const type = buf.readUInt16LE(2);
  const count = buf.readUInt16LE(4);

  console.log(`文件        ${file}`);
  console.log(`大小        ${buf.length} 字节`);
  console.log(`文件头      reserved=${reserved} type=${type} count=${count}`);

  if (reserved !== 0) throw new Error('reserved 应为 0');
  if (type !== 1) throw new Error('type 应为 1（ICO）');
  if (count === 0) throw new Error('不含任何图像');

  const found = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16;
    const w = buf[p] === 0 ? 256 : buf[p];
    const h = buf[p + 1] === 0 ? 256 : buf[p + 1];
    const bitCount = buf.readUInt16LE(p + 6);
    const bytesInRes = buf.readUInt32LE(p + 8);
    const imageOffset = buf.readUInt32LE(p + 12);

    const slice = buf.subarray(imageOffset, imageOffset + bytesInRes);
    const isPng = slice.readUInt32BE(0) === 0x89504e47;
    let real = null;
    if (isPng) {
      const s = pngSize(slice);
      real = `${s.w}×${s.h}`;
    }

    const intact = imageOffset + bytesInRes <= buf.length;
    console.log(`  图像 ${i + 1}   目录声明 ${w}×${h}  位深 ${bitCount}  数据 ${bytesInRes} 字节  ` +
                `偏移 ${imageOffset}  ${isPng ? 'PNG 内嵌，实际 ' + real : 'BMP 格式'}  ${intact ? '✓ 数据完整' : '✗ 越界'}`);
    found.push(w);
  }

  const has16 = found.includes(16);
  const has32 = found.includes(32);
  console.log(`尺寸检查    ${has16 ? '✓' : '✗'} 含 16×16   ${has32 ? '✓' : '✗'} 含 32×32`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'pack') {
  const out = rest.shift();
  if (!out || rest.length === 0) { console.error('用法: node ico.js pack <输出.ico> <输入.png...>'); process.exit(2); }
  pack(out, rest);
} else if (cmd === 'verify') {
  if (!rest[0]) { console.error('用法: node ico.js verify <文件.ico>'); process.exit(2); }
  verify(rest[0]);
} else {
  console.error('用法: node ico.js pack|verify ...');
  process.exit(2);
}
