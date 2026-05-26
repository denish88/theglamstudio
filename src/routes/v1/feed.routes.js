const router = require('express').Router()
const { feedController, referralController, contactController, ratingController, pollController } = require('../../controllers')
const { authenticate } = require('../../middlewares')

router.use(authenticate)

router.get('/posts', feedController.getPosts)
router.get('/posts/:id', feedController.getPostById)
router.post('/posts/:id/like', feedController.toggleLike)

router.post('/referral/apply', referralController.applyReferralCode)
router.get('/referral/my', referralController.getMyReferrals)

router.post('/contact', contactController.submitContact)

router.post('/ratings', ratingController.submitRating)
router.get('/ratings/my', ratingController.getMyRatings)

router.get('/polls', pollController.getActivePolls)
router.post('/polls/:id/vote', pollController.votePoll)

module.exports = router
