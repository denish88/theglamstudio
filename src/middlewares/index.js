const authenticate = require('./auth.middleware')
const adminOnly = require('./admin.middleware')
const errorHandler = require('./error.middleware')
const validate = require('./validate.middleware')
const upload = require('./upload.middleware')
const cryptoMiddleware = require('./crypto.middleware')

module.exports = {
  authenticate,
  adminOnly,
  errorHandler,
  validate,
  upload,
  cryptoMiddleware,
}
