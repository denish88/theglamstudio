const { CORS_ORIGIN, NODE_ENV } = require('../config/env')

const allowedOrigins = CORS_ORIGIN.includes(',')
  ? CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : [CORS_ORIGIN].filter(Boolean)

if (NODE_ENV === 'development') {
  for (const origin of [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ]) {
    if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin)
  }
}

function startsWithAllowedOrigin(value) {
  if (!value) return false
  return allowedOrigins.some((allowed) => {
    if (!allowed || allowed === '*') return false
    return value === allowed || value.startsWith(`${allowed}/`)
  })
}

/**
 * Media (photos + videos) may only load when embedded/fetched from our app.
 * Opening /api/v1/media/... as a new browser tab is blocked for everyone.
 * In-app <img>/<video> tags and authenticated download fetch still work.
 */
const antiHotlink = (req, res, next) => {
  const deny = (message = 'Direct access denied') =>
    res.status(403).set('Content-Type', 'text/plain').end(message)

  const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase()
  const mode = String(req.headers['sec-fetch-mode'] || '').toLowerCase()
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()

  // New tab / address-bar / "Open in new tab" = top-level navigation → always block
  // Applies equally to photos and videos.
  if (dest === 'document' || mode === 'navigate') {
    return deny('Opening media in a new tab is not allowed')
  }

  const referer = req.headers.referer || req.headers.referrer || ''
  const origin = req.headers.origin || ''
  const fromOurDomain =
    startsWithAllowedOrigin(referer) || startsWithAllowedOrigin(origin)

  const sameSite = site === 'same-origin' || site === 'same-site'
  const isImageEmbed = dest === 'image'
  const isVideoEmbed = dest === 'video'
  const isMediaEmbed = isImageEmbed || isVideoEmbed
  const isAppFetch =
    mode === 'cors' || mode === 'no-cors' || mode === 'same-origin'

  // Normal case: request comes from our frontend domain (in-app embed/fetch)
  if (fromOurDomain) {
    return next()
  }

  // Same-origin via Vite/nginx proxy (img/video or in-app fetch)
  if (sameSite && (isMediaEmbed || isAppFetch || dest === 'empty' || !dest)) {
    return next()
  }

  // Logged-in user loading <img>/<video> when referrer is stripped
  if (req.user && isMediaEmbed) {
    return next()
  }

  // Logged-in in-app download fetch (Authorization header) on same site
  if (req.user && isAppFetch && (sameSite || dest === 'empty' || !dest)) {
    return next()
  }

  return deny()
}

module.exports = antiHotlink
