const authenticate = require('./auth.middleware')
const adminOnly = require('./admin.middleware')
const authenticateApiKey = require('./apiKey.middleware')
const errorHandler = require('./error.middleware')
const validate = require('./validate.middleware')
const upload = require('./upload.middleware')
const { uploadPostMedia } = require('./upload.middleware')
const cryptoMiddleware = require('./crypto.middleware')
const antiHotlink = require('./antiHotlink.middleware')
const uploadTimeout = require('./uploadTimeout.middleware')

module.exports = {
  authenticate,
  adminOnly,
  authenticateApiKey,
  errorHandler,
  validate,
  upload,
  uploadPostMedia,
  uploadTimeout,
  cryptoMiddleware,
  antiHotlink,
}
