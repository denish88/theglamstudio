const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const r2Client = require('../config/r2')
const { R2_BUCKET } = require('../config/env')
const { ApiError, generateSignedVideoUrl } = require('../utils')

const ALLOWED_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png', '.mp4', '.webm']

const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return null

  let start = match[1] === '' ? null : Number.parseInt(match[1], 10)
  let end = match[2] === '' ? null : Number.parseInt(match[2], 10)

  if (start === null && end === null) return null
  if (Number.isNaN(start) || Number.isNaN(end)) return null

  if (start === null) {
    // bytes=-N → last N bytes
    const suffix = end
    if (suffix <= 0) return null
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else if (end === null) {
    end = size - 1
  }

  if (start >= size || start < 0) return null
  end = Math.min(end, size - 1)
  if (end < start) return null

  return { start, end }
}

function wantsForceProxy(req) {
  const raw = req.query?.proxy
  return raw === '1' || raw === 'true' || raw === true
}

/**
 * Videos: after cookie auth + anti-hotlink, 302 to a short-lived R2 signed URL
 * so bytes never pipe through Node. Photos keep streaming via the proxy.
 *
 * Opening /api/v1/media/videos/... in a new tab is still blocked by anti-hotlink
 * (Sec-Fetch-Dest: document). Force ?proxy=1 only for authenticated in-app downloads.
 */
const streamMedia = async (req, res, next) => {
  try {
    const rawSplat = req.params.splat
    const key = Array.isArray(rawSplat) ? rawSplat.join('/') : rawSplat

    const isAllowedPrefix =
      key.startsWith('posts/') ||
      key.startsWith('stories/') ||
      key.startsWith('giftboxes/') ||
      key.startsWith('videos/')
    if (!key || key.includes('..') || !isAllowedPrefix) {
      throw ApiError.badRequest('Invalid media path')
    }

    const ext = key.substring(key.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw ApiError.badRequest('Unsupported file type')
    }

    const isVideo = ext === '.mp4' || ext === '.webm'

    // ── Video offload: Node only authenticates + mints URL; R2 serves bytes ──
    if (isVideo && !wantsForceProxy(req)) {
      try {
        const signedUrl = await generateSignedVideoUrl(key)
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate')
        res.setHeader('Referrer-Policy', 'no-referrer')
        // 302 so players follow to R2; subsequent Range requests hit R2 only
        return res.redirect(302, signedUrl)
      } catch {
        // Fall through to proxy stream if signing fails (availability > offload)
      }
    }

    const headCommand = new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
    let headResult

    try {
      headResult = await r2Client.send(headCommand)
    } catch {
      throw ApiError.notFound('Media not found')
    }

    const contentLength = Number(headResult.ContentLength || 0)
    const etag = headResult.ETag
    const contentType = isVideo
      ? (CONTENT_TYPES[ext] || headResult.ContentType || 'application/octet-stream')
      : (headResult.ContentType || CONTENT_TYPES[ext] || 'application/octet-stream')

    if (!isVideo && req.headers['if-none-match'] === etag && !req.headers.range) {
      return res.status(304).end()
    }

    const range = isVideo ? parseRange(req.headers.range, contentLength) : null

    if (isVideo && req.headers.range && !range) {
      res.status(416)
      res.set({
        'Content-Range': `bytes */${contentLength}`,
        'Accept-Ranges': 'bytes',
      })
      return res.end()
    }

    const getInput = { Bucket: R2_BUCKET, Key: key }
    if (range) {
      getInput.Range = `bytes=${range.start}-${range.end}`
    }

    const getCommand = new GetObjectCommand(getInput)
    const { Body, ContentLength } = await r2Client.send(getCommand)

    res.setHeader('Content-Type', contentType)
    res.setHeader(
      'Cache-Control',
      isVideo ? 'private, no-store, no-cache, must-revalidate' : 'private, no-cache',
    )
    if (etag && !isVideo) res.setHeader('ETag', etag)
    res.setHeader('Vary', 'Cookie')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')

    if (range) {
      const chunkSize = range.end - range.start + 1
      res.status(206)
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${contentLength}`)
      res.setHeader('Content-Length', String(ContentLength || chunkSize))
    } else {
      res.status(200)
      res.setHeader('Content-Length', String(contentLength))
    }

    Body.on('error', (err) => {
      if (!res.headersSent) next(err)
      else res.destroy()
    })
    Body.pipe(res)
  } catch (error) {
    next(error)
  }
}

module.exports = { streamMedia }
