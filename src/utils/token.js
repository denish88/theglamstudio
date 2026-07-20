const jwt = require('jsonwebtoken')
const { JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN } = require('../config/env')

const PASSWORD_RESET_EXPIRES_IN = '10m'
const PASSWORD_RESET_TYPE = 'password_reset'

const generateAccessToken = (userId, deviceId) => {
  return jwt.sign({ id: userId, deviceId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

const generateRefreshToken = (userId, deviceId) => {
  return jwt.sign({ id: userId, deviceId, type: 'refresh' }, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  })
}

const generatePasswordResetToken = (userId, keyId, nonce) => {
  return jwt.sign(
    {
      id: userId,
      keyId,
      nonce,
      type: PASSWORD_RESET_TYPE,
    },
    JWT_SECRET,
    { expiresIn: PASSWORD_RESET_EXPIRES_IN },
  )
}

const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET)
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generatePasswordResetToken,
  verifyToken,
  PASSWORD_RESET_TYPE,
  PASSWORD_RESET_EXPIRES_IN,
}
