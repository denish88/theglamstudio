const { NODE_ENV } = require('../config/env')
const { encryptString, decryptString } = require('./crypto')

const COOKIE_NAME = '_glam_media'
const isProduction = NODE_ENV === 'production'

function setMediaCookie(res, token) {
  const encrypted = encryptString(token)
  if (!encrypted) return

  res.cookie(COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/api/v1/media',
    maxAge: 10 * 24 * 60 * 60 * 1000,
  })
}

function readMediaCookie(cookieValue) {
  if (!cookieValue) return null
  return decryptString(cookieValue)
}

function clearMediaCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/api/v1/media',
  })
}

module.exports = { setMediaCookie, readMediaCookie, clearMediaCookie, COOKIE_NAME }
