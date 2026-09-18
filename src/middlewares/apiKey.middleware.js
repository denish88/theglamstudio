const crypto = require('crypto')
const { OPEN_API_KEY } = require('../config/env')
const ApiError = require('../utils/apiError')

/**
 * Authenticate machine clients with a shared API key.
 * Accepts either:
 *   X-API-Key: <key>
 *   Authorization: ApiKey <key>
 */
function authenticateApiKey(req, res, next) {
  try {
    if (!OPEN_API_KEY || String(OPEN_API_KEY).trim().length < 16) {
      throw ApiError.serviceUnavailable('Open API is not configured on this server')
    }

    const headerKey = req.headers['x-api-key']
    const authHeader = req.headers.authorization || ''
    let provided = ''

    if (typeof headerKey === 'string' && headerKey.trim()) {
      provided = headerKey.trim()
    } else if (authHeader.toLowerCase().startsWith('apikey ')) {
      provided = authHeader.slice(7).trim()
    }

    if (!provided) {
      throw ApiError.unauthorized('API key is required (X-API-Key header)')
    }

    const expected = Buffer.from(String(OPEN_API_KEY))
    const actual = Buffer.from(provided)

    if (
      expected.length !== actual.length
      || !crypto.timingSafeEqual(expected, actual)
    ) {
      throw ApiError.unauthorized('Invalid API key')
    }

    req.apiKeyAuth = true
    req.createdVia = 'open-api'
    next()
  } catch (error) {
    next(error)
  }
}

module.exports = authenticateApiKey
