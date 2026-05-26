const router = require('express').Router()
const { userController, directoryController, postController, contactController, ratingController } = require('../../controllers')
const { authenticate, adminOnly, upload } = require('../../middlewares')

router.use(authenticate, adminOnly)

// ── User management ──
router.post('/users', userController.createUser)
router.get('/users', userController.listUsers)
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

module.exports = router
