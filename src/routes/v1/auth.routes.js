const router = require('express').Router()
const { authController } = require('../../controllers')
const { authenticate, validate } = require('../../middlewares')

const loginSchema = {
  keyId: { required: true, type: 'string' },
  password: { required: true, type: 'string', minLength: 6 },
}

const changePasswordSchema = {
  currentPassword: { required: true, type: 'string', minLength: 6 },
  newPassword: { required: true, type: 'string', minLength: 6 },
}

const setScreenLockSchema = {
  pin: { required: true, type: 'string', minLength: 4 },
}

const verifyScreenLockSchema = {
  pin: { required: true, type: 'string', minLength: 4 },
}

router.post('/login', validate(loginSchema), authController.login)
router.post('/logout', authenticate, authController.logout)
router.get('/me', authenticate, authController.getMe)
router.post('/age-consent', authenticate, authController.confirmAgeConsent)
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword)
router.post('/screen-lock', authenticate, validate(setScreenLockSchema), authController.setScreenLock)
router.post('/screen-lock/lock', authenticate, authController.lockScreen)
router.post('/screen-lock/verify', authenticate, validate(verifyScreenLockSchema), authController.verifyScreenLock)
router.post('/screen-lock/disable', authenticate, validate(verifyScreenLockSchema), authController.disableScreenLock)
router.post('/refresh', authController.refreshAccessToken)

module.exports = router
