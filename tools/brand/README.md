# 品牌资源生成工具

用于生成与校验 [`career-pilot-web/public/images/brand/`](../../career-pilot-web/public/images/brand/) 下的品牌资源。
图形本身是手写的 SVG 矢量文件（位于 `public/images/brand/`），本目录的工具负责**把它们变成位图并验证结果**。

## 为什么是这套方案

本机**没有** ImageMagick、Inkscape、rsvg-convert、sharp、Pillow、cairosvg。
因此：

- **SVG → PNG** 走无头 Chrome 渲染 —— Chrome 本身就是一个完整的 SVG 渲染引擎，
  配合 `--default-background-color=00000000` 可以得到真正的透明背景。
- **ICO** 由 `ico.js` 手工构造容器格式（6 字节文件头 + 每张图 16 字节目录项 + 内嵌 PNG），
  生成的是真 ICO，不是把 PNG 改扩展名。

## 工具清单

| 文件 | 用途 |
|---|---|
| `render.js` | SVG → PNG。支持任意尺寸与透明背景 |
| `verify-png.js` | 解码 PNG 全部像素（含反滤波），报告尺寸、颜色类型、alpha 分布 |
| `dominant-colors.js` | 统计主色分布 + 检查各品牌色是否仍在画面中可辨 |
| `ascii-art.js` | 位图转字符画，每个字符代表一个品牌色 —— **用于「看到」渲染结果** |
| `ico.js` | ICO 打包与结构验证 |
| `preview.html` | 品牌资源预览页，双击打开即可 |

## 常用命令

```bash
B=career-pilot-web/public/images/brand

# 渲染主图标（1024×1024）
node tools/brand/render.js $B/logo.svg $B/logo.png 1024

# 渲染组合 Logo（宽 700 高 264）
node tools/brand/render.js $B/logo-horizontal.svg $B/logo-horizontal.png 700x264

# 批量渲染多档尺寸（输出 前缀-尺寸.png）
node tools/brand/render.js $B/favicon.svg /tmp/fav 16,32,48

# 校验透明通道与尺寸
node tools/brand/verify-png.js $B/logo.png 1024 1024

# 查看渲染结果（字符画）
node tools/brand/ascii-art.js $B/favicon-32x32.png

# 打包 ICO 并验证
node tools/brand/ico.js pack $B/favicon.ico /tmp/fav-16.png /tmp/fav-32.png /tmp/fav-48.png
node tools/brand/ico.js verify $B/favicon.ico
```

## 依赖

- **Node.js**（无第三方包，仅用内置的 `fs` / `path` / `zlib` / `child_process`）
- **Chrome 或 Edge**：脚本会自动查找常见安装位置，也可用环境变量指定：

  ```bash
  CHROME_PATH="/path/to/chrome" node tools/brand/render.js ...
  ```

## 注意

`ascii-art.js` 的颜色归类会把**抗锯齿边缘**归到最近的颜色类别，可能出现「某颜色出现在不该出现的位置」。
判断时应结合 `alpha < 0.75` 的像素会被标为 `+` 这一点一起看 —— 若某处只有 `+` 而没有对应的实心字符，
说明那里只是边缘，不是实心区域。
