const authController = require('./auth.controller')
const userController = require('./user.controller')
const directoryController = require('./directory.controller')
const postController = require('./post.controller')
const feedController = require('./feed.controller')
const referralController = require('./referral.controller')
const mediaController = require('./media.controller')
const contactController = require('./contact.controller')
const ratingController = require('./rating.controller')
const pollController = require('./poll.controller')
const announcementController = require('./announcement.controller')
const paymentHistoryController = require('./paymentHistory.controller')

module.exports = {
  authController,
  userController,
  directoryController,
  postController,
  feedController,
  referralController,
  mediaController,
  contactController,
  ratingController,
  pollController,
  announcementController,
  paymentHistoryController,
}
