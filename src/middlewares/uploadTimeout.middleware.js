const UPLOAD_REQUEST_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes for large multi-image uploads

function uploadTimeout(req, res, next) {
  req.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS)
  res.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS)
  next()
}

module.exports = uploadTimeout
