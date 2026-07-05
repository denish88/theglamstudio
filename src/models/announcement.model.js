const mongoose = require('mongoose')

const SITE_ANNOUNCEMENT_KEY = 'site'

const announcementSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: SITE_ANNOUNCEMENT_KEY,
      unique: true,
      sparse: true,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

announcementSchema.index({ singletonKey: 1, deletedAt: 1 })
announcementSchema.index({ isActive: 1, deletedAt: 1 })

const Announcement = mongoose.model('Announcement', announcementSchema)

module.exports = Announcement
module.exports.SITE_ANNOUNCEMENT_KEY = SITE_ANNOUNCEMENT_KEY
