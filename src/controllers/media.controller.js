const fs = require('fs')
const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const r2Client = require('../config/r2')
const { R2_BUCKET } = require('../config/env')
const { ApiError, generateSignedVideoUrl } = require('../utils')
const { getCachedImage, destroyR2Body } = require('../utils/imageFileCache')

const ALLOWED_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png', '.mp4', '.webm']

const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/** UUID media keys are immutable once uploaded — safe short private browser cache. */
const IMAGE_CACHE_CONTROL = 'private, max-age=3600, immutable'
const VIDEO_CACHE_CONTROL = 'private, no-store, no-cache, must-revalidate'

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

function isNotFoundError(err) {
  const name = err?.name || err?.Code || err?.code
  const status = err?.$metadata?.httpStatusCode
  return (
    name === 'NotFound' ||
    name === 'NoSuchKey' ||
    name === '404' ||
    status === 404
  )
}

function etagMatches(header, etag) {
  if (!header || !etag) return false
  const expected = etag.trim()
  return String(header)
    .split(',')
    .some((part) => {
      const value = part.trim()
      return value === expected || value === `W/${expected}`
    })
}

function destroyStream(stream) {
  destroyR2Body(stream)
}

/**
 * Stop reading if the client leaves, without treating a finished response as an abort.
 * Do not listen to req 'close': for a GET that event means the request is already
 * fully received, and destroying the body there blanks the image.
 */
function pipeStream(source, res) {
  if (!source || typeof source.pipe !== 'function') {
    destroyStream(source)
    return Promise.reject(ApiError.internal('Invalid media stream'))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const done = (err) => {
      if (settled) return
      settled = true
      res.off('close', onClose)
      if (err && !res.headersSent) {
        destroyStream(source)
        reject(err)
        return
      }
      if (err) destroyStream(source)
      if (err && !res.writableFinished && !res.destroyed) res.destroy()
      resolve()
    }

    const onClose = () => {
      if (!res.writableFinished) {
        destroyStream(source)
        done()
      }
    }

    res.on('close', onClose)
    source.on('error', (err) => done(err))
    res.on('finish', () => done())
    source.pipe(res)
  })
}

function pipeFile(res, filePath) {
  return pipeStream(fs.createReadStream(filePath), res)
}

function setCommonMediaHeaders(res, { contentType, isVideo, etag }) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', isVideo ? VIDEO_CACHE_CONTROL : IMAGE_CACHE_CONTROL)
  if (etag && !isVideo) res.setHeader('ETag', etag)
  res.setHeader('Vary', 'Cookie')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', 'inline')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
}

function rethrowImageCacheError(err, res) {
  if (err instanceof ApiError) throw err
  if (err.code === 'MEDIA_BUSY' || err.code === 'R2_TIMEOUT') {
    res.setHeader('Retry-After', '2')
    throw ApiError.serviceUnavailable('Images are busy, please refresh')
  }
  if (err.code === 'MEDIA_TOO_BIG') throw ApiError.badRequest('Media file is too large')
  throw err
}

/**
 * Photos stay behind cookie auth + anti-hotlink. Bytes come from the local
 * cache; R2 is only used to fill a miss and that socket is released before
 * we write the response.
 */
async function serveCachedImage(req, res, key, ext) {
  let cached
  try {
    cached = await getCachedImage(key, CONTENT_TYPES[ext] || 'application/octet-stream')
  } catch (err) {
    rethrowImageCacheError(err, res)
  }

  try {
    if (res.destroyed || res.writableEnded) return

    const etag = cached.etag
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.setHeader('ETag', etag)
      res.setHeader('Cache-Control', IMAGE_CACHE_CONTROL)
      res.setHeader('Vary', 'Cookie')
      res.status(304).end()
      return
    }

    setCommonMediaHeaders(res, {
      contentType: cached.contentType,
      isVideo: false,
      etag,
    })
    res.status(200)
    res.setHeader('Content-Length', String(cached.size))

    // RAM/disk bytes only. The R2 socket was already released when the file was cached.
    if (cached.buffer) {
      res.end(cached.buffer)
      return
    }

    await pipeFile(res, cached.filePath)
  } finally {
    cached.release()
  }
}

/**
 * Videos: after cookie auth + anti-hotlink, 302 to a short-lived R2 signed URL
 * so bytes never pipe through Node. Photos never get a signed URL.
 *
 * Opening /api/v1/media/... in a new tab is still blocked by anti-hotlink
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

    if (!isVideo) {
      await serveCachedImage(req, res, key, ext)
      return
    }

    // ── Video offload: Node only authenticates + mints URL; R2 serves bytes ──
    if (!wantsForceProxy(req)) {
      try {
        const signedUrl = await generateSignedVideoUrl(key)
        res.setHeader('Cache-Control', VIDEO_CACHE_CONTROL)
        res.setHeader('Referrer-Policy', 'no-referrer')
        return res.redirect(302, signedUrl)
      } catch {
        // Fall through to proxy stream if signing fails (availability > offload)
      }
    }

    const headCommand = new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
    let headResult

    try {
      headResult = await r2Client.send(headCommand)
    } catch (err) {
      if (isNotFoundError(err)) throw ApiError.notFound('Media not found')
      throw err
    }

    const contentLength = Number(headResult.ContentLength || 0)
    const contentType =
      CONTENT_TYPES[ext] || headResult.ContentType || 'application/octet-stream'
    const range = parseRange(req.headers.range, contentLength)

    if (req.headers.range && !range) {
      res.status(416)
      res.set({
        'Content-Range': `bytes */${contentLength}`,
        'Accept-Ranges': 'bytes',
      })
      return res.end()
    }

    const getInput = { Bucket: R2_BUCKET, Key: key }
    if (range) getInput.Range = `bytes=${range.start}-${range.end}`

    let getResult
    try {
      getResult = await r2Client.send(new GetObjectCommand(getInput))
    } catch (err) {
      if (isNotFoundError(err)) throw ApiError.notFound('Media not found')
      throw err
    }

    const { Body, ContentLength, ContentRange } = getResult
    if (res.destroyed || res.writableEnded) {
      destroyR2Body(Body)
      return
    }

    setCommonMediaHeaders(res, { contentType, isVideo: true })

    if (range) {
      const chunkSize = range.end - range.start + 1
      res.status(206)
      res.setHeader(
        'Content-Range',
        ContentRange || `bytes ${range.start}-${range.end}/${contentLength}`,
      )
      res.setHeader('Content-Length', String(ContentLength || chunkSize))
    } else {
      res.status(200)
      res.setHeader('Content-Length', String(contentLength))
    }

    await pipeStream(Body, res)
  } catch (error) {
    next(error)
  }
}

module.exports = { streamMedia }
