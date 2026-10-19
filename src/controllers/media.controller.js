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

/**
 * Pipe R2 GetObject Body → res and free the SDK socket if the client aborts
 * mid-transfer (otherwise keepAlive sockets stay held until process restart).
 */
function pipeR2Body(Body, req, res, next) {
  if (!Body || typeof Body.pipe !== 'function') {
    return next(ApiError.internal('Invalid media stream'))
  }

  let finished = false

  const releaseSocket = () => {
    if (finished) return
    finished = true
    req.off('close', onClientGone)
    res.off('close', onClientGone)
    res.off('finish', onComplete)
    if (typeof Body.destroy === 'function' && !Body.destroyed) {
      Body.destroy()
    }
  }

  const onComplete = () => {
    finished = true
    req.off('close', onClientGone)
    res.off('close', onClientGone)
  }

  const onClientGone = () => {
    // Client navigated away / cancelled — abort R2 read so the socket returns to the pool.
    if (!res.writableEnded) releaseSocket()
  }

  req.on('close', onClientGone)
  res.on('close', onClientGone)
  res.on('finish', onComplete)

  Body.on('error', (err) => {
    releaseSocket()
    if (!res.headersSent) next(err)
    else if (!res.destroyed) res.destroy()
  })

  Body.pipe(res)
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

/**
 * Videos: after cookie auth + anti-hotlink, 302 to a short-lived R2 signed URL
 * so bytes never pipe through Node. Photos stay on this proxy (no copyable
 * signed image URL in DevTools).
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
        res.setHeader('Cache-Control', VIDEO_CACHE_CONTROL)
        res.setHeader('Referrer-Policy', 'no-referrer')
        // 302 so players follow to R2; subsequent Range requests hit R2 only
        return res.redirect(302, signedUrl)
      } catch {
        // Fall through to proxy stream if signing fails (availability > offload)
      }
    }

    const ifNoneMatch = req.headers['if-none-match']
    const needsHead =
      isVideo || (!isVideo && Boolean(ifNoneMatch) && !req.headers.range)

    let contentLength = 0
    let etag
    let headContentType

    if (needsHead) {
      try {
        const headResult = await r2Client.send(
          new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
        )
        contentLength = Number(headResult.ContentLength || 0)
        etag = headResult.ETag
        headContentType = headResult.ContentType
      } catch (err) {
        if (isNotFoundError(err)) throw ApiError.notFound('Media not found')
        throw err
      }

      // Cheap 304 — HeadObject only, no GetObject body / no held stream socket.
      if (!isVideo && ifNoneMatch === etag && !req.headers.range) {
        if (etag) res.setHeader('ETag', etag)
        res.setHeader('Cache-Control', IMAGE_CACHE_CONTROL)
        res.setHeader('Vary', 'Cookie')
        return res.status(304).end()
      }
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

    let getResult
    try {
      getResult = await r2Client.send(new GetObjectCommand(getInput))
    } catch (err) {
      if (isNotFoundError(err)) throw ApiError.notFound('Media not found')
      throw err
    }

    const { Body, ContentLength, ContentType, ETag, ContentRange } = getResult

    etag = etag || ETag
    const resolvedLength =
      contentLength ||
      Number(ContentLength || 0) ||
      0

    const contentType = isVideo
      ? CONTENT_TYPES[ext] || headContentType || ContentType || 'application/octet-stream'
      : headContentType || ContentType || CONTENT_TYPES[ext] || 'application/octet-stream'

    setCommonMediaHeaders(res, { contentType, isVideo, etag })

    if (range) {
      const chunkSize = range.end - range.start + 1
      res.status(206)
      res.setHeader(
        'Content-Range',
        ContentRange || `bytes ${range.start}-${range.end}/${resolvedLength}`,
      )
      res.setHeader('Content-Length', String(ContentLength || chunkSize))
    } else {
      res.status(200)
      const length = Number(ContentLength || resolvedLength || 0)
      if (length > 0) res.setHeader('Content-Length', String(length))
    }

    pipeR2Body(Body, req, res, next)
  } catch (error) {
    next(error)
  }
}

module.exports = { streamMedia }
