const { User } = require('../models')
const { ApiError, ApiResponse, generateAccessToken, generateRefreshToken, verifyToken, setMediaCookie, clearMediaCookie } = require('../utils')
const crypto = require('crypto')

function generateDeviceKeyID() {
  const seg = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let s = ''
    for (let i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length))
    return s
  }
  return `${seg()}-${seg()}-${seg()}-${seg()}-${seg()}`
}

const { normalizeKeyId } = require('../utils/keyId')

const login = async (req, res, next) => {
  try {
    const { keyId, password } = req.body

    const normalizedKeyId = normalizeKeyId(keyId)
    if (!normalizedKeyId) {
      throw ApiError.unauthorized('Invalid Key ID or password')
    }

    const user = await User.findOne({
      keyId: normalizedKeyId,
      deletedAt: null,
    }).select('+password +refreshToken')
    if (!user) {
      throw ApiError.unauthorized('Invalid Key ID or password')
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated. Contact support.')
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid Key ID or password')
    }

    const deviceKeyID = generateDeviceKeyID()

    const accessToken = generateAccessToken(user._id, deviceKeyID)
    const refreshToken = generateRefreshToken(user._id, deviceKeyID)

    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    const browserFingerprint = req.headers['user-agent'] || null

    user.deviceId = deviceKeyID
    user.refreshToken = refreshToken
    user.ipAddress = ipAddress
    user.addLoginActivity(ipAddress, browserFingerprint)
    await user.save({ validateBeforeSave: false })

    setMediaCookie(res, accessToken)

    ApiResponse.success(res, {
      ...user.toSafeObject(),
      deviceKeyID,
      authToken: accessToken,
      refreshToken,
    }, 'User logged in successfully')
  } catch (error) {
    next(error)
  }
}

const logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      refreshToken: null,
      deviceId: null,
    })

    clearMediaCookie(res)

    ApiResponse.success(res, {}, 'Logged out successfully')
  } catch (error) {
    next(error)
  }
}

const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    ApiResponse.success(res, user.toSafeObject())
  } catch (error) {
    next(error)
  }
}

const confirmAgeConsent = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (!user.ageConsentConfirmed) {
      user.ageConsentConfirmed = true
      user.ageConsentConfirmedAt = new Date()
      await user.save({ validateBeforeSave: false })
    }

    ApiResponse.success(res, user.toSafeObject(), 'Age consent confirmed')
  } catch (error) {
    next(error)
  }
}

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body

    if (currentPassword === newPassword) {
      throw ApiError.badRequest('New password must be different from the current password')
    }

    const user = await User.findById(req.user._id).select('+password')
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    const isMatch = await user.comparePassword(currentPassword)
    if (!isMatch) {
      throw ApiError.badRequest('Current password is incorrect')
    }

    user.password = newPassword
    await user.save()

    ApiResponse.success(res, {}, 'Password changed successfully')
  } catch (error) {
    next(error)
  }
}

const PIN_REGEX = /^\d{4}$/
const MAX_PIN_ATTEMPTS = 5
const PIN_COOLDOWN_MS = 60 * 1000

const setScreenLock = async (req, res, next) => {
  try {
    const { pin, currentPin } = req.body

    if (!PIN_REGEX.test(String(pin || ''))) {
      throw ApiError.badRequest('PIN must be exactly 4 digits')
    }

    const user = await User.findById(req.user._id).select('+screenLockPin')
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (user.screenLockEnabled && user.screenLockPin) {
      if (!PIN_REGEX.test(String(currentPin || ''))) {
        throw ApiError.badRequest('Current PIN is required to change the screen lock')
      }
      if (String(currentPin) !== String(user.screenLockPin)) {
        throw ApiError.badRequest('Current PIN is incorrect')
      }
      if (String(pin) === String(user.screenLockPin)) {
        throw ApiError.badRequest('New PIN must be different from the current PIN')
      }
    }

    user.screenLockPin = String(pin)
    user.screenLockEnabled = true
    user.screenLockLocked = false
    user.screenLockAttempts = 0
    user.screenLockLockedUntil = null
    await user.save({ validateBeforeSave: false })

    ApiResponse.success(res, user.toSafeObject(), 'Screen lock saved')
  } catch (error) {
    next(error)
  }
}

const lockScreen = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (!user.screenLockEnabled) {
      throw ApiError.badRequest('Screen lock is not set up')
    }

    user.screenLockLocked = true
    await user.save({ validateBeforeSave: false })

    ApiResponse.success(res, user.toSafeObject(), 'Screen locked')
  } catch (error) {
    next(error)
  }
}

const verifyScreenLock = async (req, res, next) => {
  try {
    const { pin } = req.body

    const user = await User.findById(req.user._id).select(
      '+screenLockPin +screenLockAttempts +screenLockLockedUntil',
    )
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (!user.screenLockEnabled || !user.screenLockPin) {
      throw ApiError.badRequest('Screen lock is not set up')
    }

    if (user.screenLockLockedUntil && user.screenLockLockedUntil > new Date()) {
      const waitSeconds = Math.ceil((user.screenLockLockedUntil - new Date()) / 1000)
      throw ApiError.tooMany(`Too many attempts. Try again in ${waitSeconds}s`)
    }

    if (!PIN_REGEX.test(String(pin || '')) || String(pin) !== String(user.screenLockPin)) {
      user.screenLockAttempts = (user.screenLockAttempts || 0) + 1

      let message = 'Incorrect PIN'
      if (user.screenLockAttempts >= MAX_PIN_ATTEMPTS) {
        user.screenLockAttempts = 0
        user.screenLockLockedUntil = new Date(Date.now() + PIN_COOLDOWN_MS)
        message = `Too many attempts. Try again in ${PIN_COOLDOWN_MS / 1000}s`
      }

      await user.save({ validateBeforeSave: false })
      throw ApiError.badRequest(message)
    }

    user.screenLockLocked = false
    user.screenLockAttempts = 0
    user.screenLockLockedUntil = null
    await user.save({ validateBeforeSave: false })

    ApiResponse.success(res, user.toSafeObject(), 'Unlocked')
  } catch (error) {
    next(error)
  }
}

const disableScreenLock = async (req, res, next) => {
  try {
    const { pin } = req.body

    const user = await User.findById(req.user._id).select('+screenLockPin')
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (!user.screenLockEnabled || !user.screenLockPin) {
      throw ApiError.badRequest('Screen lock is not set up')
    }

    if (String(pin) !== String(user.screenLockPin)) {
      throw ApiError.badRequest('Incorrect PIN')
    }

    user.screenLockPin = null
    user.screenLockEnabled = false
    user.screenLockLocked = false
    user.screenLockAttempts = 0
    user.screenLockLockedUntil = null
    await user.save({ validateBeforeSave: false })

    ApiResponse.success(res, user.toSafeObject(), 'Screen lock removed')
  } catch (error) {
    next(error)
  }
}

const refreshAccessToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) {
      throw ApiError.badRequest('Refresh token is required')
    }

    let decoded
    try {
      decoded = verifyToken(refreshToken)
    } catch {
      throw ApiError.unauthorized('Invalid or expired refresh token')
    }

    if (decoded.type !== 'refresh') {
      throw ApiError.unauthorized('Invalid token type')
    }

    const user = await User.findById(decoded.id).select('+refreshToken')
    if (!user || user.refreshToken !== refreshToken) {
      throw ApiError.unauthorized('Refresh token is invalid or revoked')
    }

    if (user.deviceId && decoded.deviceId && user.deviceId !== decoded.deviceId) {
      throw ApiError.unauthorized('Session expired. Logged in from another device.')
    }

    const newAccessToken = generateAccessToken(user._id, user.deviceId)

    setMediaCookie(res, newAccessToken)

    ApiResponse.success(res, { authToken: newAccessToken }, 'Token refreshed')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  login,
  logout,
  getMe,
  confirmAgeConsent,
  changePassword,
  setScreenLock,
  lockScreen,
  verifyScreenLock,
  disableScreenLock,
  refreshAccessToken,
}
