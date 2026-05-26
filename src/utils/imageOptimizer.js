const sharp = require('sharp')

const MAX_WIDTH = 1440
const MAX_HEIGHT = 1440
const SIZE_THRESHOLD = 2 * 1024 * 1024
const WEBP_QUALITY = 84

async function optimizeImage(buffer) {
  const metadata = await sharp(buffer).metadata()
  const needsResize =
    buffer.length > SIZE_THRESHOLD &&
    (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT)

  let pipeline = sharp(buffer)

  if (needsResize) {
    pipeline = pipeline.resize({
      width: MAX_WIDTH,
      height: MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  const optimized = await pipeline
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()

  return optimized
}

module.exports = { optimizeImage }
