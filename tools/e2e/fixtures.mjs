/**
 * 简历上传测试文件的动态构造器（curl 验收与浏览器 e2e 共用，零依赖、零二进制入库）。
 *
 * 为什么动态构造：仓库保持零二进制资产；每一种格式都在内存中按格式规范拼装——
 * DOCX 是 ZIP 容器（stored 方式手写），PDF 是最小合法结构（未压缩 content stream），
 * HTML/TXT 为纯文本。生成结果均为**内容真实有效**的文件，可被 Tika 正确解析。
 *
 * 直接运行可从命令行生成一组文件（供 curl 验收使用）：
 *   node tools/e2e/fixtures.mjs --out ./tmp-fixtures
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/* ------------------------------------------------------------------ DOCX */

/** 构造最小可解析的 DOCX（OOXML）：word/document.xml + 两个容器部件，ZIP 以 stored 打包 */
export function buildDocx(paragraphs) {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

  return zipStored([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ])
}

function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * 手写 ZIP 容器（stored 方式，即不压缩）。
 *
 * 不压缩是刻意的：DOCX 的解析器对 stored 与 deflate 一视同仁，
 * 而 stored 省去在测试工具里实现压缩流的复杂度。CRC32 用 Node 内置的 zlib.crc32。
 */
function zipStored(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = zlib.crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // 本地文件头签名
    local.writeUInt16LE(20, 4) // 解压所需版本
    local.writeUInt16LE(0x0800, 6) // 标志位：文件名为 UTF-8
    local.writeUInt16LE(0, 8) // 压缩方式：stored
    local.writeUInt16LE(0, 10) // 修改时间
    local.writeUInt16LE(0x21, 12) // 修改日期（1980-01-01）
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18) // 压缩后大小
    local.writeUInt32LE(entry.data.length, 22) // 原始大小
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // 扩展字段长度
    chunks.push(local, name, entry.data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0) // 中央目录签名
    cd.writeUInt16LE(20, 4) // 创建版本
    cd.writeUInt16LE(20, 6) // 解压所需版本
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(entry.data.length, 20)
    cd.writeUInt32LE(entry.data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    // 扩展/注释/磁盘号/内部属性/外部属性 均为 0（偏移 30–41）
    cd.writeUInt32LE(offset, 42) // 对应的本地文件头偏移
    central.push(cd, name)

    offset += local.length + name.length + entry.data.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // 中央目录结束记录
  eocd.writeUInt16LE(entries.length, 8) // 本磁盘记录数
  eocd.writeUInt16LE(entries.length, 10) // 总记录数
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16) // 中央目录偏移
  return Buffer.concat([...chunks, centralBuf, eocd])
}

/* ------------------------------------------------------------------- PDF */

/** 最小合法 PDF（未压缩 content stream，Helvetica 字体，可提取英文文本） */
export function buildPdf(lines) {
  const ops = lines
    .map((line, i) => `${i === 0 ? '' : '0 -16 Td '}(${escapePdfText(line)}) Tj`)
    .join(' ')
  return assemblePdf(`BT /F1 12 Tf 72 720 Td ${ops} ET`)
}

/** 无文本层的 PDF：有页面但 content stream 为空（模拟扫描件的"提不出文字"） */
export function buildEmptyPdf() {
  return assemblePdf('')
}

/**
 * 按 PDF 结构拼装：对象 → xref 表 → trailer。
 * xref 中的每个对象偏移必须精确，用累计字节数记录。
 */
function assemblePdf(contentStream) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n${contentStream}\nendstream`,
  ]

  const parts = []
  let offset = 0
  const offsets = []
  const push = (text) => {
    const buf = Buffer.from(text, 'latin1')
    parts.push(buf)
    offset += buf.length
  }

  push('%PDF-1.4\n')
  objects.forEach((body, i) => {
    offsets.push(offset)
    push(`${i + 1} 0 obj\n${body}\nendobj\n`)
  })

  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const position of offsets) {
    xref += `${String(position).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  return Buffer.concat(parts)
}

function escapePdfText(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

/* -------------------------------------------------------------- HTML / TXT */

export function buildHtml(text) {
  return Buffer.from(
    `<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><title>简历</title></head>\n`
    + `<body><h1>个人简历</h1>\n<p>${text}</p></body>\n</html>\n`,
    'utf8',
  )
}

export function buildTxt(text) {
  return Buffer.from(text, 'utf8')
}

/* ---------------------------------------------------------------- CLI 生成 */

/** 供 curl 验收使用的示例文本（50 字符以上，超过"过短"阈值） */
const SAMPLE_TEXT = '张三，计算机科学与技术专业本科应届生，熟悉 Java、Spring Boot、MySQL，'
  + '参与过校园二手交易平台的后端开发，负责用户模块与订单模块的接口设计与实现。'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const outDir = outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : './fixtures'

  fs.mkdirSync(outDir, { recursive: true })
  const files = {
    'resume-cn.docx': buildDocx([SAMPLE_TEXT, '技能：Java、Spring Boot、MySQL、Git。']),
    'resume-en.pdf': buildPdf([
      'Zhang San - Backend Developer Resume',
      'Skills: Java, Spring Boot, MySQL, Git.',
      'Project: Campus second-hand trading platform backend.',
    ]),
    'resume.html': buildHtml(SAMPLE_TEXT),
    'resume.txt': buildTxt(SAMPLE_TEXT),
    'empty.pdf': buildEmptyPdf(),
    'fake.pdf': Buffer.from('this is not a pdf at all, just plain text pretending'),
    'binary.txt': Buffer.concat([Buffer.from([0x4d, 0x5a, 0x00, 0x00]), Buffer.alloc(256, 0x00), Buffer.from('MZ fake exe')]),
    'fake.png': Buffer.from('not an image, renamed to png'),
  }
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), data)
    console.log(`${name}  ${data.length} bytes`)
  }
  console.log(`\n已生成到 ${outDir}（DOC 需另行准备真实样例文件）`)
}
