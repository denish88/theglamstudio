const UPLOAD_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

function uploadTimeout(req, res, next) {
  req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS)
  res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS)
  next()
}

module.exports = uploadTimeout
