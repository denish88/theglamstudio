const mongoose = require('mongoose')

const SITE_GIFT_BOX_KEY = 'site'
const MAX_GIFT_IMAGES = 12

const giftImageSchema = new mongoose.Schema(
  {
    imageKey: {
      type: String,
      required: true,
    },
    thumbnailKey: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
)

const giftBoxSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: SITE_GIFT_BOX_KEY,
      unique: true,
      sparse: true,
    },
    images: {
      type: [giftImageSchema],
      default: [],
      validate: {
        validator(value) {
          return !value || value.length <= MAX_GIFT_IMAGES
        },
        message: `Gift box can have at most ${MAX_GIFT_IMAGES} images`,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
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

giftBoxSchema.index({ singletonKey: 1, deletedAt: 1 })
giftBoxSchema.index({ isActive: 1, deletedAt: 1 })

const GiftBox = mongoose.model('GiftBox', giftBoxSchema)

module.exports = GiftBox
module.exports.SITE_GIFT_BOX_KEY = SITE_GIFT_BOX_KEY
module.exports.MAX_GIFT_IMAGES = MAX_GIFT_IMAGES
