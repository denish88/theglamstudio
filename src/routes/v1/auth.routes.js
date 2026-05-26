const router = require('express').Router()
const { authController } = require('../../controllers')
const { authenticate, validate } = require('../../middlewares')

const loginSchema = {
  keyId: { required: true, type: 'string' },
  password: { required: true, type: 'string', minLength: 6 },
}

router.post('/login', validate(loginSchema), authController.login)
router.post('/logout', authenticate, authController.logout)
router.get('/me', authenticate, authController.getMe)
router.post('/refresh', authController.refreshAccessToken)

module.exports = router
