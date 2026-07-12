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

async function optimizeImage(buffer) {
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

  const optimized = await pipeline
    .webp({ quality, effort: 4, smartSubsample: true })
    .toBuffer()

  return { buffer: optimized, ext: 'webp', contentType: 'image/webp' }
}

module.exports = { optimizeImage }
