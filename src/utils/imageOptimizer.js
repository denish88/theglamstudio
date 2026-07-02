const sharp = require('sharp')

const MAX_WIDTH = 1440
const MAX_HEIGHT = 1440
const SIZE_THRESHOLD = 1024 * 1024
const WEBP_QUALITY = 82

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

  return pipeline
    .webp({ quality: WEBP_QUALITY, effort: 2, smartSubsample: true })
    .toBuffer()
}

module.exports = { optimizeImage }
