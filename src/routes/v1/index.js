const router = require('express').Router()
const authRoutes = require('./auth.routes')
const adminRoutes = require('./admin.routes')
const feedRoutes = require('./feed.routes')
const mediaRoutes = require('./media.routes')

router.use('/auth', authRoutes)
router.use('/admin', adminRoutes)
router.use('/feed', feedRoutes)
router.use('/media', mediaRoutes)

module.exports = router
