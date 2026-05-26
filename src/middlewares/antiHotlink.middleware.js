const { CORS_ORIGIN, NODE_ENV } = require('../config/env')

const allowedOrigins = CORS_ORIGIN.includes(',')
  ? CORS_ORIGIN.split(',').map((o) => o.trim())
  : [CORS_ORIGIN]

if (NODE_ENV === 'development') {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174')
}

const antiHotlink = (req, res, next) => {
  const referer = req.headers.referer || req.headers.referrer || ''

  if (!referer) {
    return res.status(403).set('Content-Type', 'text/plain').end('Direct access denied')
  }

  const isAllowed = allowedOrigins.some((allowed) => {
    if (allowed === '*') return true
    return referer.startsWith(allowed)
  })

  if (!isAllowed) {
    return res.status(403).set('Content-Type', 'text/plain').end('Access denied')
  }

  next()
}

module.exports = antiHotlink
