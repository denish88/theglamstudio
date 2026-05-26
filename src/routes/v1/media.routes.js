const router = require('express').Router()
const { mediaController } = require('../../controllers')
const { antiHotlink } = require('../../middlewares')
const { ApiError, verifyToken, COOKIE_NAME, readMediaCookie } = require('../../utils')
const { User } = require('../../models')

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
    const user = await User.findById(decoded.id).select('_id isActive deviceId')

    if (!user || !user.isActive) {
      return res.status(401).set('Content-Type', 'text/plain').end('Unauthorized')
    }

    if (user.deviceId && decoded.deviceId && user.deviceId !== decoded.deviceId) {
      return res.status(401).set('Content-Type', 'text/plain').end('Session expired')
    }

    req.user = user
    next()
  } catch {
    return res.status(401).set('Content-Type', 'text/plain').end('Unauthorized')
  }
}

router.get('/{*splat}', authenticateMedia, antiHotlink, mediaController.streamMedia)

module.exports = router
