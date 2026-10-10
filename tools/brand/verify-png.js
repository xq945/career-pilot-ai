/**
 * PNG 真实性校验：解析文件结构并解码全部像素，报告尺寸、颜色类型与 alpha 分布。
 * 用途：验证「PNG 是不是真 PNG」「透明背景是不是真透明」，而不是看文件大小猜测。
 *
 * 用法：node verify-png.js <file.png> [期望宽] [期望高]
 */
const fs = require('fs');
const zlib = require('zlib');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decode(file) {
  const buf = fs.readFileSync(file);

  // 签名
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('不是 PNG：文件签名不匹配');
  }

  // 遍历 chunk
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let sawIEND = false;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      sawIEND = true;
    }
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('缺少 IHDR');
  if (!sawIEND) throw new Error('缺少 IEND，文件不完整');

  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = CHANNELS[ihdr.colorType];
  if (!ch) throw new Error('未知颜色类型 ' + ihdr.colorType);
  if (ihdr.interlace !== 0) throw new Error('暂不支持隔行扫描 PNG');
  if (ihdr.depth !== 8) throw new Error('仅支持 8 位深，实际 ' + ihdr.depth);

  // 解码像素
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * ch;
  const out = Buffer.alloc(ihdr.height * stride);
  let rp = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const ft = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= ch) ? prev[x - ch] : 0;
      const v = line[x];
      let r;
      switch (ft) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error('未知 filter 类型 ' + ft + ' @ 行 ' + y);
      }
      cur[x] = r & 0xff;
    }
  }

  return { ihdr, channels: ch, pixels: out };
}

module.exports = { decode };

// 作为 CLI 直接运行时才执行下面的校验输出
if (require.main !== module) return;

const file = process.argv[2];
if (!file) { console.error('用法: node verify-png.js <file.png> [期望宽] [期望高]'); process.exit(2); }

try {
  const { ihdr, channels, pixels } = decode(file);
  const { width: w, height: h, colorType } = ihdr;
  const size = fs.statSync(file).size;
  const typeName = { 0: '灰度', 2: 'RGB(无 alpha)', 3: '索引色', 4: '灰度+alpha', 6: 'RGBA' }[colorType];

  console.log(`文件        ${file}`);
  console.log(`大小        ${size} 字节`);
  console.log(`尺寸        ${w} × ${h}`);
  console.log(`颜色类型    ${colorType} (${typeName})，${channels} 通道/像素`);

  // 尺寸断言
  const expW = process.argv[3] ? Number(process.argv[3]) : null;
  const expH = process.argv[4] ? Number(process.argv[4]) : null;
  if (expW && expH) {
    console.log(`尺寸核对    ${w === expW && h === expH ? '✓ 与期望一致' : `✗ 期望 ${expW}×${expH}`}`);
  }

  if (channels === 4) {
    let t0 = 0, tMid = 0, t255 = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      const a = pixels[i];
      if (a === 0) t0++;
      else if (a === 255) t255++;
      else tMid++;
    }
    const total = w * h;
    const pct = (n) => (n / total * 100).toFixed(1) + '%';
    console.log(`alpha 分布  全透明 ${t0} (${pct(t0)}) | 半透明 ${tMid} (${pct(tMid)}) | 不透明 ${t255} (${pct(t255)})`);
    console.log(`透明通道    ${t0 > 0 ? '✓ 存在真正的全透明像素，背景确为透明' : '✗ 无全透明像素'}`);
  } else {
    console.log('透明通道    ✗ 该文件不含 alpha 通道');
  }
} catch (e) {
  console.error('校验失败：' + e.message);
  process.exit(1);
}
