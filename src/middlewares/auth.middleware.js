const { ApiError, verifyToken } = require('../utils')
const { User } = require('../models')

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Access token is required')
    }

    const token = authHeader.split(' ')[1]
    const decoded = verifyToken(token)

    const user = await User.findById(decoded.id)
    if (!user) {
      throw ApiError.unauthorized('User not found')
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated')
    }

    if (user.deviceId && decoded.deviceId && user.deviceId !== decoded.deviceId) {
      throw ApiError.unauthorized('Session expired. Your account is logged in on another device.')
    }

    req.user = user
    next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Invalid or expired token'))
    }
    next(error)
  }
}

module.exports = authenticate
