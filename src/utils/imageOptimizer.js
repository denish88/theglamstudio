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
// Text burned into full-size images before WebP encode.
const WATERMARK_TEXT = '@theglamclub1'
/** Overall opacity of text + side lines (0–1). 2% = very subtle. */
const WATERMARK_OPACITY = 0.02
/**
 * Font size as a fraction of min(width, height).
 * Final px = clamp(minSide * WATERMARK_FONT_SIZE, 12, 56)
 */
const WATERMARK_FONT_SIZE = 0.028
/** Vertical position of first diagonal mark (0–1 of image height). */
const WATERMARK_ROW_1_POSITION = 0.25
/** Vertical position of second diagonal mark (0–1 of image height). */
const WATERMARK_ROW_2_POSITION = 0.75
/**
 * Line stroke as a fraction of image width.
 * Final px = max(1, width * WATERMARK_LINE_WIDTH)
 */
const WATERMARK_LINE_WIDTH = 0.00115
/** Diagonal tilt in degrees (negative = bottom-left → top-right). */
const WATERMARK_ANGLE = -30

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildWatermarkSvg(width, height) {
  const minSide = Math.min(width, height)
  const fontSize = Math.round(
    Math.min(56, Math.max(12, minSide * WATERMARK_FONT_SIZE)),
  )
  const strokeWidth = Math.max(1, Math.round(width * WATERMARK_LINE_WIDTH * 10) / 10)
  const text = escapeXml(WATERMARK_TEXT)
  // Approximate rendered text width for centering the side rules.
  const textWidth = WATERMARK_TEXT.length * fontSize * 0.56
  const gap = fontSize * 0.7
  // Longer arms so the mark still spans nicely after rotation.
  const armLength = Math.max(width * 0.28, textWidth * 0.9)
  const centerX = width / 2
  const leftLineEnd = centerX - textWidth / 2 - gap
  const rightLineStart = centerX + textWidth / 2 + gap
  const leftLineStart = leftLineEnd - armLength
  const rightLineEnd = rightLineStart + armLength

  const rows = [WATERMARK_ROW_1_POSITION, WATERMARK_ROW_2_POSITION]
    .map((ratio) => {
      const y = Math.round(height * ratio)
      return `
      <g transform="rotate(${WATERMARK_ANGLE} ${centerX} ${y})">
        <line
          x1="${leftLineStart}"
          y1="${y}"
          x2="${leftLineEnd}"
          y2="${y}"
          stroke="#ffffff"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
        />
        <text
          x="${centerX}"
          y="${y}"
          fill="#ffffff"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fontSize}"
          font-weight="600"
          text-anchor="middle"
          dominant-baseline="middle"
          letter-spacing="0.04em"
        >${text}</text>
        <line
          x1="${rightLineStart}"
          y1="${y}"
          x2="${rightLineEnd}"
          y2="${y}"
          stroke="#ffffff"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
        />
      </g>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g opacity="${WATERMARK_OPACITY}">${rows}
  </g>
</svg>`
}

/**
 * Overlay two subtle diagonal brand watermarks on an image buffer.
 * Returns a raster buffer (same pixel size). WebP conversion should happen after.
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

  const svg = Buffer.from(buildWatermarkSvg(width, height))

  return image
    .composite([
      {
        input: svg,
        top: 0,
        left: 0,
      },
    ])
    .toBuffer()
}

/**
 * @param {Buffer} buffer
 * @param {{ watermark?: boolean }} [options] - watermark defaults to true
 */
async function optimizeImage(buffer, options = {}) {
  const applyWatermark = options.watermark !== false

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

  // Finalize rotate/resize first so watermark SVG matches the final pixel size.
  // Resolution / quality settings above are unchanged; WebP runs last.
  let processed = await pipeline.toBuffer()

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
  // Tunable watermark constants (for tests / future config)
  WATERMARK_TEXT,
  WATERMARK_OPACITY,
  WATERMARK_FONT_SIZE,
  WATERMARK_ROW_1_POSITION,
  WATERMARK_ROW_2_POSITION,
  WATERMARK_LINE_WIDTH,
  WATERMARK_ANGLE,
}
