const { ApiError } = require('../utils')

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(ApiError.forbidden('Admin access required'))
  }
  next()
}

module.exports = adminOnly
