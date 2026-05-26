const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const r2Client = require('../config/r2')
const { R2_BUCKET } = require('../config/env')
const { ApiError } = require('../utils')

const ALLOWED_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png']

const streamMedia = async (req, res, next) => {
  try {
    const rawSplat = req.params.splat
    const key = Array.isArray(rawSplat) ? rawSplat.join('/') : rawSplat

    if (!key || key.includes('..') || !key.startsWith('posts/')) {
      throw ApiError.badRequest('Invalid media path')
    }

    const ext = key.substring(key.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw ApiError.badRequest('Unsupported file type')
    }

    const headCommand = new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
    let headResult

    try {
      headResult = await r2Client.send(headCommand)
    } catch {
      throw ApiError.notFound('Media not found')
    }

    const contentType = headResult.ContentType || 'image/webp'
    const contentLength = headResult.ContentLength
    const etag = headResult.ETag

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end()
    }

    const getCommand = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
    const { Body } = await r2Client.send(getCommand)

    res.set({
      'Content-Type': contentType,
      'Content-Length': contentLength,
      'Cache-Control': 'private, no-cache',
      'ETag': etag,
      'Vary': 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    })

    Body.pipe(res)
  } catch (error) {
    next(error)
  }
}

module.exports = { streamMedia }
