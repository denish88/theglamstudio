const sharp = require('sharp')

// All images are converted to high-quality WebP. Images are only downscaled
// when they exceed the max dimensions or the size threshold; otherwise the
// original resolution is kept and just re-encoded to WebP at high quality.
const SIZE_THRESHOLD = 3 * 1024 * 1024 // 3 MB
const MAX_WIDTH = 3840
const MAX_HEIGHT = 3840
const WEBP_QUALITY = 95

// Smaller source files can afford maximum quality without much size cost.
const SMALL_FILE_THRESHOLD = 1024 * 1024 // 1 MB
const SMALL_FILE_QUALITY = 100

// ── Watermark settings (easy to tune) ──────────────────────────────────────
// Burned into full-size images after resize and before WebP encode.
const WATERMARK_TEXT = '@theglamclub1'
/**
 * Final overlay strength (0–1), applied to the PNG alpha channel in pixel space.
 * Note: SVG group opacity alone is unreliable with Sharp/librsvg; we do not rely on it.
 * Below ~0.06 is usually invisible to the eye after WebP. 0.10–0.14 is subtle but readable.
 */
const WATERMARK_OPACITY = 0.10
/**
 * Font size as a fraction of min(width, height).
 * Final px = clamp(minSide * WATERMARK_FONT_SIZE, 16, 64)
 */
const WATERMARK_FONT_SIZE = 0.032
/** Diagonal tilt in degrees (negative = rising left → right). */
const WATERMARK_ANGLE = -32
/**
 * How many parallel diagonal rows of repeated text.
 * Keep at 1 for a single centered diagonal band.
 */
const WATERMARK_ROW_COUNT = 1
/**
 * Vertical gap between parallel rows, as a fraction of min(width, height).
 */
const WATERMARK_ROW_SPACING = 0.14
/**
 * Extra horizontal gap between repeated names, as a fraction of font size.
 */
const WATERMARK_REPEAT_GAP = 1.35

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Build a centered diagonal repeating-name overlay (opaque drawing).
 * Opacity is applied later via the alpha channel.
 * White fill + soft dark edge so it stays readable on light and dark photos.
 */
function buildWatermarkSvg(width, height) {
  const minSide = Math.min(width, height)
  const fontSize = Math.round(
    Math.min(64, Math.max(16, minSide * WATERMARK_FONT_SIZE)),
  )
  const textStroke = Math.max(1, fontSize * 0.04)
  const text = escapeXml(WATERMARK_TEXT)
  const fontFamily = 'DejaVu Sans, Arial, Helvetica, sans-serif'

  // Approximate advance width of one label + spacing between repeats.
  const labelWidth = WATERMARK_TEXT.length * fontSize * 0.58
  const step = labelWidth + fontSize * WATERMARK_REPEAT_GAP

  // Cover the full diagonal so rotated rows still fill the frame.
  const cover = Math.sqrt(width * width + height * height) * 1.25
  const repeatCount = Math.max(3, Math.ceil(cover / step) + 1)
  const startX = -((repeatCount - 1) * step) / 2

  const rowCount = Math.max(1, Math.round(WATERMARK_ROW_COUNT))
  const rowGap = Math.max(fontSize * 2.2, minSide * WATERMARK_ROW_SPACING)
  const firstRowY = -((rowCount - 1) * rowGap) / 2

  const cx = width / 2
  const cy = height / 2

  const rows = []
  for (let r = 0; r < rowCount; r += 1) {
    const y = firstRowY + r * rowGap
    const labels = []
    for (let i = 0; i < repeatCount; i += 1) {
      const x = startX + i * step
      labels.push(`
        <text
          x="${x}" y="${y}"
          fill="#000000" fill-opacity="0.5"
          stroke="#000000" stroke-opacity="0.3"
          stroke-width="${textStroke * 1.3}"
          font-family="${fontFamily}"
          font-size="${fontSize}" font-weight="700"
          text-anchor="middle" dy="0.35em"
        >${text}</text>
        <text
          x="${x}" y="${y}"
          fill="#ffffff"
          font-family="${fontFamily}"
          font-size="${fontSize}" font-weight="700"
          text-anchor="middle" dy="0.35em"
        >${text}</text>`)
    }
    rows.push(labels.join(''))
  }

  // Translate to photo center, then rotate — keeps the whole pattern centered.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g transform="translate(${cx} ${cy}) rotate(${WATERMARK_ANGLE})">
    ${rows.join('\n')}
  </g>
</svg>`
}

/**
 * Scale the alpha channel of an RGBA buffer in-place (opacity 0–1).
 */
function applyAlphaOpacity(rgba, opacity) {
  const o = Math.min(1, Math.max(0, opacity))
  for (let i = 3; i < rgba.length; i += 4) {
    rgba[i] = Math.round(rgba[i] * o)
  }
  return rgba
}

/**
 * Overlay a centered diagonal repeating brand watermark.
 * Returns a raster buffer at the same pixel size (PNG). WebP encode happens after.
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>}
 */
async function addWatermark(inputBuffer) {
  const image = sharp(inputBuffer, { failOn: 'none' })
  const metadata = await image.metadata()
  const width = metadata.width || 0
  const height = metadata.height || 0

  if (!width || !height) {
    return inputBuffer
  }

  // 1) Rasterize SVG at full strength into RGBA (librsvg handles fonts/rotation here).
  const svg = Buffer.from(buildWatermarkSvg(width, height))
  const overlay = await sharp(svg, { density: 72 })
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // 2) Apply opacity in pixel space so WebP/composite always see real transparency.
  applyAlphaOpacity(overlay.data, WATERMARK_OPACITY)

  // 3) Composite over the photo.
  return sharp(inputBuffer, { failOn: 'none' })
    .ensureAlpha()
    .composite([
      {
        input: overlay.data,
        raw: {
          width: overlay.info.width,
          height: overlay.info.height,
          channels: 4,
        },
        top: 0,
        left: 0,
        blend: 'over',
      },
    ])
    .png({ compressionLevel: 1 })
    .toBuffer()
}

/**
 * @param {Buffer} buffer
 * @param {{ watermark?: boolean }} [options] - watermark defaults to true
 */
async function optimizeImage(buffer, options = {}) {
  // Allow legacy call style: optimizeImage(buf, mimetypeString)
  const opts = typeof options === 'string' ? {} : options || {}
  const applyWatermark = opts.watermark !== false

  const metadata = await sharp(buffer).metadata()
  const width = metadata.width || 0
  const height = metadata.height || 0

  const needsResize =
    width > MAX_WIDTH ||
    height > MAX_HEIGHT ||
    buffer.length > SIZE_THRESHOLD

  const quality = buffer.length < SMALL_FILE_THRESHOLD ? SMALL_FILE_QUALITY : WEBP_QUALITY

  let pipeline = sharp(buffer, { failOn: 'none' }).rotate()

  if (needsResize) {
    pipeline = pipeline.resize({
      width: MAX_WIDTH,
      height: MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  // Lossless intermediate so the watermark is not crushed by a JPEG pass.
  let processed = await pipeline.png({ compressionLevel: 1 }).toBuffer()

  if (applyWatermark) {
    processed = await addWatermark(processed)
  }

  const optimized = await sharp(processed, { failOn: 'none' })
    .webp({ quality, effort: 4, smartSubsample: true })
    .toBuffer()

  return { buffer: optimized, ext: 'webp', contentType: 'image/webp' }
}

/**
 * Create a small square thumbnail for story circles on the home screen.
 * Uses cover crop so the circle always fills cleanly.
 * Thumbnails are not watermarked (too small; keeps circle UI clean).
 */
async function createStoryThumbnail(buffer) {
  const thumb = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(240, 240, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: false,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer()

  return { buffer: thumb, ext: 'webp', contentType: 'image/webp' }
}

/**
 * Produce both the full story image (high quality WebP) and a circle thumbnail.
 */
async function createStoryImages(buffer) {
  const [original, thumbnail] = await Promise.all([
    optimizeImage(buffer),
    createStoryThumbnail(buffer),
  ])
  return { original, thumbnail }
}

/**
 * Gift box preview: keep full image in frame (no cover crop).
 * Thumbnails are not watermarked.
 */
async function createGiftBoxThumbnail(buffer) {
  const thumb = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(480, 480, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 85, effort: 4 })
    .toBuffer()

  return { buffer: thumb, ext: 'webp', contentType: 'image/webp' }
}

async function createGiftBoxImages(buffer) {
  const [original, thumbnail] = await Promise.all([
    optimizeImage(buffer),
    createGiftBoxThumbnail(buffer),
  ])
  return { original, thumbnail }
}

module.exports = {
  optimizeImage,
  addWatermark,
  createStoryThumbnail,
  createStoryImages,
  createGiftBoxThumbnail,
  createGiftBoxImages,
  WATERMARK_TEXT,
  WATERMARK_OPACITY,
  WATERMARK_FONT_SIZE,
  WATERMARK_ANGLE,
  WATERMARK_ROW_COUNT,
  WATERMARK_ROW_SPACING,
  WATERMARK_REPEAT_GAP,
}
