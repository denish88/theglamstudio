const { NODE_ENV } = require('../config/env')

const COOKIE_NAME = '_glam_media'
const isProduction = NODE_ENV === 'production'

function setMediaCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/api/v1/media',
    maxAge: 10 * 24 * 60 * 60 * 1000,
  })
}

function clearMediaCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/api/v1/media',
  })
}

module.exports = { setMediaCookie, clearMediaCookie, COOKIE_NAME }
