const mongoose = require('mongoose')

const SITE_STORY_KEY = 'site'

const storyViewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
)

const storySchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: SITE_STORY_KEY,
      unique: true,
      sparse: true,
    },
    imageKey: {
      type: String,
      required: true,
    },
    thumbnailKey: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    views: {
      type: [storyViewSchema],
      default: [],
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

storySchema.index({ singletonKey: 1, deletedAt: 1 })
storySchema.index({ isActive: 1, deletedAt: 1 })

const Story = mongoose.model('Story', storySchema)

module.exports = Story
module.exports.SITE_STORY_KEY = SITE_STORY_KEY
