const router = require('express').Router()
const { feedController, referralController } = require('../../controllers')
const { authenticate } = require('../../middlewares')

router.use(authenticate)

router.get('/posts', feedController.getPosts)
router.get('/posts/:id', feedController.getPostById)
router.post('/posts/:id/like', feedController.toggleLike)

router.post('/referral/apply', referralController.applyReferralCode)
router.get('/referral/my', referralController.getMyReferrals)

module.exports = router
