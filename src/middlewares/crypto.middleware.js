const { encrypt, decrypt } = require('../utils/crypto')
const { ENABLE_ENCRYPTION } = require('../config/env')

const ENCRYPT_HEADER = 'x-encrypted'

const cryptoMiddleware = (req, res, next) => {
  if (req.headers[ENCRYPT_HEADER] === 'true' && req.body?.payload) {
    const decrypted = decrypt(req.body.payload)
    if (!decrypted) {
      return res.status(400).json({
        statusCode: 400,
        status: 0,
        message: 'Failed to decrypt request payload',
        data: [],
        metadata: [],
      })
    }
    req.body = decrypted
  }

  if (!ENABLE_ENCRYPTION) return next()

  const originalJson = res.json.bind(res)

  res.json = function (body) {
    if (body && typeof body === 'object' && body.statusCode !== undefined) {
      const encrypted = encrypt(body)
      if (encrypted) {
        return originalJson({
          encrypted: true,
          payload: encrypted,
        })
      }
    }
    return originalJson(body)
  }

  next()
}

module.exports = cryptoMiddleware
