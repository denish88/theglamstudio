const { NODE_ENV, API_PUBLIC_URL, FRONTEND_URL } = require('../config/env')
const { encryptString, decryptString } = require('./crypto')

const COOKIE_NAME = '_glam_media'
const isProduction = NODE_ENV === 'production'

/**
 * Share the media cookie across theglamstudio.bond and api.theglamstudio.bond.
 * <img> requests cannot send the Authorization header, so they rely on this cookie.
 */
function sharedCookieDomain() {
  if (!isProduction) return undefined

  for (const raw of [API_PUBLIC_URL, FRONTEND_URL]) {
    if (!raw) continue
    try {
      const hostname = new URL(raw).hostname
      const parts = hostname.split('.').filter(Boolean)
      if (parts.length >= 2 && parts[parts.length - 1] !== 'localhost') {
        return `.${parts.slice(-2).join('.')}`
      }
    } catch {
      // ignore invalid URL
    }
  }

  return undefined
}

function mediaCookieOptions() {
  const domain = sharedCookieDomain()
  return {
    httpOnly: true,
    secure: isProduction,
    // None lets the site on theglamstudio.bond send this cookie to the API host.
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/v1/media',
    ...(domain ? { domain } : {}),
  }
}

function setMediaCookie(res, token) {
  const encrypted = encryptString(token)
  if (!encrypted) return

  res.cookie(COOKIE_NAME, encrypted, {
    ...mediaCookieOptions(),
    maxAge: 10 * 24 * 60 * 60 * 1000,
  })
}

function readMediaCookie(cookieValue) {
  if (!cookieValue) return null
  return decryptString(cookieValue)
}

function clearMediaCookie(res) {
  res.clearCookie(COOKIE_NAME, mediaCookieOptions())
}

module.exports = { setMediaCookie, readMediaCookie, clearMediaCookie, COOKIE_NAME }
