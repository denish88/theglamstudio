const router = require('express').Router()
const { userController, directoryController, postController, contactController, ratingController, pollController } = require('../../controllers')
const { authenticate, adminOnly, upload } = require('../../middlewares')

router.use(authenticate, adminOnly)

// ── User management ──
router.post('/users', userController.createUser)
router.get('/users', userController.listUsers)
router.post('/users/check-subscriptions', userController.checkExpiredSubscriptions)
router.get('/users/:id', userController.getUserDetail)
router.get('/users/:id/referrals', userController.getReferralStats)
router.patch('/users/:id/toggle-active', userController.toggleUserActive)
router.patch('/users/:id/points', userController.updateUserPoints)
router.delete('/users/:id', userController.deleteUser)

// ── Directory management ──
router.post('/directories', directoryController.createDirectory)
router.get('/directories', directoryController.listDirectories)
router.get('/directories/:id', directoryController.getDirectory)
router.put('/directories/:id', directoryController.updateDirectory)
router.delete('/directories/:id', directoryController.deleteDirectory)

// ── Post management ──
router.post('/posts', upload.array('images', 20), postController.createPost)
router.get('/posts', postController.listPosts)
router.get('/posts/:id', postController.getPost)
router.put('/posts/:id', upload.array('images', 20), postController.updatePost)
router.delete('/posts/:id', postController.deletePost)

// ── Contact queries ──
router.get('/contacts', contactController.listContacts)
router.patch('/contacts/:id/read', contactController.markAsRead)
router.delete('/contacts/:id', contactController.deleteContact)

// ── Ratings ──
router.get('/ratings', ratingController.listAllRatings)
router.delete('/ratings/:id', ratingController.deleteRating)

// ── Polls ──
router.post('/polls', pollController.createPoll)
router.get('/polls', pollController.listPolls)
router.get('/polls/:id/results', pollController.getPollResults)
router.patch('/polls/:id/toggle-active', pollController.togglePollActive)
router.delete('/polls/:id', pollController.deletePoll)

module.exports = router
