const sharp = require('sharp')

// All images are converted to high-quality WebP. Images are only downscaled
// when they exceed the max dimensions or the size threshold; otherwise the
// original resolution is kept and just re-encoded to WebP at high quality.
const SIZE_THRESHOLD = 3 * 1024 * 1024 // 3 MB
const MAX_WIDTH = 2560
const MAX_HEIGHT = 2560
const WEBP_QUALITY = 95

async function optimizeImage(buffer) {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width || 0
  const height = metadata.height || 0

  const needsResize =
    width > MAX_WIDTH ||
    height > MAX_HEIGHT ||
    buffer.length > SIZE_THRESHOLD

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
    .webp({ quality: WEBP_QUALITY, effort: 4, smartSubsample: true })
    .toBuffer()

  return { buffer: optimized, ext: 'webp', contentType: 'image/webp' }
}

module.exports = { optimizeImage }
