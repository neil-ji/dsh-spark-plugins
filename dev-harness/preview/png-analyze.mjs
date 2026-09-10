/**
 * 悬浮球特写的像素分析（零依赖，自己解 PNG + inflate），输出「径向剖面」。
 * 用途：没有可用视觉模型时，用真实渲染像素复核配色结论（冷暖、标识可见度、
 * 外发光强弱、焦点环位置与颜色）。
 *
 *   node dev-harness/preview/png-analyze.mjs .dev/ball-review/after-light-rest.png
 *   node dev-harness/preview/png-analyze.mjs --pad 22 --ball 48 <png...>
 *
 * 半径一律以**球半径**为单位（截图 clip = 球 ± pad，故球半径在图里的像素数可反推）。
 * 球内主色取「众数」（量化到 4 级）而不是均值 —— 均值会被标识笔画带偏。
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

/** 最小 PNG 解码：8bit，color type 2(RGB) / 6(RGBA)，非隔行。 */
function decodePng(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png: ' + path)
  let off = 8
  let w = 0
  let h = 0
  let channels = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      const depth = data[8]; const colorType = data[9]; const interlace = data[12]
      if (depth !== 8) throw new Error('unsupported bit depth ' + depth)
      if (interlace !== 0) throw new Error('interlaced png unsupported')
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
      if (channels === 0) throw new Error('unsupported color type ' + colorType)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const out = Buffer.alloc(h * stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y === 0 ? null : out.subarray((y - 1) * stride, y * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev === null ? 0 : prev[i]
      const c = prev === null || i < channels ? 0 : prev[i - channels]
      const v = src[i]
      cur[i] = filter === 0 ? v
        : filter === 1 ? (v + a) & 0xff
        : filter === 2 ? (v + b) & 0xff
        : filter === 3 ? (v + ((a + b) >> 1)) & 0xff
        : (v + paeth(a, b, c)) & 0xff
    }
  }
  return {
    w, h, channels,
    px(x, y) { const i = y * stride + x * channels; return [out[i], out[i + 1], out[i + 2]] },
  }
}

const toLum = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const [hi, lo] = toLum(a) >= toLum(b) ? [toLum(a), toLum(b)] : [toLum(b), toLum(a)]
  return (hi + 0.05) / (lo + 0.05)
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : Number(args[i + 1]) }
const PAD = flag('pad', 22)
const BALL = flag('ball', 48)
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))

for (const file of files) {
  const img = decodePng(file)
  const cx = (img.w - 1) / 2
  const cy = (img.h - 1) / 2
  const ballR = (img.w / 2) * (BALL / 2) / ((BALL / 2) + PAD)
  const ring = (r0, r1) => {
    let n = 0
    const sum = [0, 0, 0]
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const d = Math.hypot(x - cx, y - cy)
        if (d < r0 * ballR || d > r1 * ballR) continue
        const p = img.px(x, y)
        n++
        sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]
      }
    }
    return n === 0 ? null : sum.map((v) => v / n)
  }
  // 球内主色（众数，量化到 4 级）：避开标识笔画的干扰；极值给出标识对比度
  const counts = new Map()
  let markMin = null
  let markMax = null
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (Math.hypot(x - cx, y - cy) > ballR * 0.9) continue
      const p = img.px(x, y)
      const key = p.map((v) => v >> 2).join(',')
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (markMin === null || toLum(p) < toLum(markMin)) markMin = p
      if (markMax === null || toLum(p) > toLum(markMax)) markMax = p
    }
  }
  const modeKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const mode = modeKey.split(',').map((v) => Number(v) * 4 + 1)
  const share = (counts.get(modeKey) / total * 100).toFixed(0)

  console.log('\n■ ' + file.split(/[\\/]/).pop() + `  (${img.w}x${img.h}, 球半径 ${ballR.toFixed(1)}px)`)
  console.log(`  球面主色 ${hex(mode)}（占球内 ${share}%）  R-B ${mode[0] - mode[2] >= 0 ? '+' : ''}${mode[0] - mode[2]}` +
    `   标识极差 ${ratio(markMax, markMin).toFixed(1)}:1   ${mode[0] - mode[2] > 6 ? '暖' : mode[0] - mode[2] < -6 ? '冷' : '中性'}`)
  const steps = [0.2, 0.5, 0.75, 0.9, 0.97, 1.03, 1.1, 1.2, 1.3, 1.5, 1.8]
  console.log('  径向剖面（r = 球半径；0.97–1.03 = 描边，1.03–1.3 = 外发光，1.5+ = 背景）：')
  for (let i = 0; i < steps.length - 1; i++) {
    console.log(`    ${steps[i]}–${steps[i + 1]}r ${hex(ring(steps[i], steps[i + 1]))}`)
  }
}
