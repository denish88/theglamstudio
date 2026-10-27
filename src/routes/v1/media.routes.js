const router = require('express').Router()
const { mediaController } = require('../../controllers')
const { antiHotlink } = require('../../middlewares')
const { ApiError, verifyToken, COOKIE_NAME, readMediaCookie } = require('../../utils')
const { User } = require('../../models')

// Scrolling loads many photos per user. Re-check the account from Mongo on a
// short interval instead of once per image, or 100 people scrolling stalls the DB.
const MEDIA_AUTH_TTL_MS = 20_000
const mediaAuthCache = new Map()

function readMediaAuth(userId) {
  const hit = mediaAuthCache.get(userId)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    mediaAuthCache.delete(userId)
    return null
  }
  return hit
}

function writeMediaAuth(user) {
  const userId = String(user._id)
  if (mediaAuthCache.size > 5000) {
    const oldest = mediaAuthCache.keys().next().value
    mediaAuthCache.delete(oldest)
  }
  mediaAuthCache.set(userId, {
    expiresAt: Date.now() + MEDIA_AUTH_TTL_MS,
    isActive: Boolean(user.isActive),
    deviceId: user.deviceId || null,
  })
}

const authenticateMedia = async (req, res, next) => {
  try {
    let token = null

    if (req.cookies && req.cookies[COOKIE_NAME]) {
      token = readMediaCookie(req.cookies[COOKIE_NAME])
    }

    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1]
      }
    }

    if (!token) {
      return res.status(401).set('Content-Type', 'text/plain').end('Unauthorized')
    }

    const decoded = verifyToken(token)
    const cachedAuth = readMediaAuth(String(decoded.id))
    if (cachedAuth) {
      if (!cachedAuth.isActive) {
        return res.status(401).set('Content-Type', 'text/plain').end('Unauthorized')
      }
      if (cachedAuth.deviceId && decoded.deviceId && cachedAuth.deviceId !== decoded.deviceId) {
        return res.status(401).set('Content-Type', 'text/plain').end('Session expired')
      }
      req.user = { _id: decoded.id, isActive: cachedAuth.isActive, deviceId: cachedAuth.deviceId }
      return next()
    }

    const user = await User.findById(decoded.id).select('_id isActive deviceId')

    if (!user || !user.isActive) {
      return res.status(401).set('Content-Type', 'text/plain').end('Unauthorized')
    }

    if (user.deviceId && decoded.deviceId && user.deviceId !== decoded.deviceId) {
      return res.status(401).set('Content-Type', 'text/plain').end('Session expired')
    }

    writeMediaAuth(user)
    req.user = user
    next()
  } catch {
    return res.status(401).set('Content-Type', 'text/plain').end('Unauthorized')
  }
}

router.get('/{*splat}', authenticateMedia, antiHotlink, mediaController.streamMedia)

// Videos: after auth + anti-hotlink, controller 302s to a short-lived R2 signed URL
// (bytes served by R2). Use ?proxy=1 to force Node streaming (in-app downloads).
// Photos: auth + anti-hotlink, then served from the local image cache. R2 is
// only contacted to fill a cache miss, never streamed straight to the browser.

module.exports = router
