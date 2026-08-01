const router = require('express').Router()
const { pushController } = require('../../controllers')
const { authenticate, adminOnly } = require('../../middlewares')

// Public — works whether or not the visitor is logged in
router.get('/vapid-public-key', pushController.getVapidPublicKey)
router.post('/subscribe', pushController.subscribe)
router.post('/unsubscribe', pushController.unsubscribe)

// Admin manual broadcast / test
router.post('/broadcast', authenticate, adminOnly, pushController.broadcast)

module.exports = router
