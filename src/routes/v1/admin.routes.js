const router = require('express').Router()
const {
  userController,
  directoryController,
  postController,
  ratingController,
  announcementController,
  activityController,
  storyController,
  giftBoxController,
  requestSessionController,
} = require('../../controllers')
const { authenticate, adminOnly, upload, uploadPostMedia, uploadTimeout } = require('../../middlewares')

router.use(authenticate, adminOnly)

// ── User activity / fraud detection ──
router.get('/activity/suspicious', activityController.getSuspiciousUsers)

// ── User management ──
router.post('/users', userController.createUser)
router.get('/users/collectors', userController.listCollectors)
router.get('/users', userController.listUsers)
router.post('/users/check-subscriptions', userController.checkExpiredSubscriptions)
router.get('/users/:id', userController.getUserDetail)
router.get('/users/:id/locations', userController.getUserLocations)
router.get('/users/:id/referrals', userController.getReferralStats)
router.patch('/users/:id/toggle-active', userController.toggleUserActive)
router.patch('/users/:id/toggle-download', userController.toggleUserDownload)
router.patch('/users/:id/points', userController.updateUserPoints)
router.patch('/users/:id/subscription', userController.updateUserSubscription)
router.post('/users/:id/password-reset-link', userController.createPasswordResetLink)
router.delete('/users/:id', userController.deleteUser)

// ── Directory management ──
router.post('/directories', directoryController.createDirectory)
router.get('/directories', directoryController.listDirectories)
router.get('/directories/:id', directoryController.getDirectory)
router.put('/directories/:id', directoryController.updateDirectory)
router.delete('/directories/:id', directoryController.deleteDirectory)

// ── Post management ──
router.post(
  '/posts',
  uploadTimeout,
  uploadPostMedia.fields([
    { name: 'images', maxCount: 20 },
    { name: 'video', maxCount: 1 },
  ]),
  postController.createPost,
)
router.get('/posts', postController.listPosts)
router.patch('/posts/:id/category', postController.updatePostCategory)
router.get('/posts/:id', postController.getPost)
router.put(
  '/posts/:id',
  uploadTimeout,
  uploadPostMedia.fields([
    { name: 'images', maxCount: 20 },
    { name: 'video', maxCount: 1 },
  ]),
  postController.updatePost,
)
router.delete('/posts/:id', postController.deletePost)

// ── Story (single active story) ──
router.get('/stories', storyController.getStory)
router.post('/stories', uploadTimeout, upload.single('image'), storyController.createOrReplaceStory)
router.patch('/stories/toggle-active', storyController.toggleStoryActive)
router.delete('/stories', storyController.deleteStory)

// ── Gift Box (downloadable home gifts) ──
router.get('/giftboxes', giftBoxController.getGiftBox)
router.post('/giftboxes', uploadTimeout, upload.array('images', 12), giftBoxController.saveGiftBox)
router.patch('/giftboxes/toggle-active', giftBoxController.toggleGiftBoxActive)
router.delete('/giftboxes/images/:imageId', giftBoxController.deleteGiftImage)
router.delete('/giftboxes', giftBoxController.deleteGiftBox)

// ── Ratings ──
router.get('/ratings', ratingController.listAllRatings)
router.delete('/ratings/:id', ratingController.deleteRating)

// ── Announcements (single site-wide announcement) ──
router.get('/announcements', announcementController.getAnnouncement)
router.put('/announcements', announcementController.saveAnnouncement)

// ── Request Session (name-edit chat) ──
router.patch('/request-session/enabled', requestSessionController.setRequestSessionEnabled)
router.patch('/request-session/:id/approve', requestSessionController.approveRequest)
router.delete('/request-session/:id', requestSessionController.deleteRequest)

module.exports = router
