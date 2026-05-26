const jwt = require('jsonwebtoken')
const { JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN } = require('../config/env')

const generateAccessToken = (userId, deviceId) => {
  return jwt.sign({ id: userId, deviceId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

const generateRefreshToken = (userId, deviceId) => {
  return jwt.sign({ id: userId, deviceId, type: 'refresh' }, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  })
}

const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET)
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
}
