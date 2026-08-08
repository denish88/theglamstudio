const mongoose = require('mongoose')

const VALID_CATEGORIES = [0, 1, 2, 3, 4, 5, 6, 7]
const VIDEO_CATEGORIES = [6, 7]
const IMAGE_CATEGORIES = [0, 1, 2, 3, 4, 5]

const postSchema = new mongoose.Schema(
  {
    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },
    imageUrl: {
      type: [String],
      default: [],
    },
    videoUrl: {
      type: String,
      default: null,
    },
    isMultiImage: {
      type: Boolean,
      default: false,
    },
    caption: {
      type: String,
      default: '',
      trim: true,
    },
    totalLikes: {
      type: Number,
      default: 0,
      min: 0,
    },
    isWatermarked: {
      type: Boolean,
      default: true,
    },
    directory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Directory',
      required: [true, 'Directory is required'],
    },
    category: {
      type: Number,
      enum: VALID_CATEGORIES,
      required: [true, 'Category is required'],
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

postSchema.index({ deletedAt: 1, isActive: 1, category: 1, _id: -1 })
postSchema.index({ directory: 1, deletedAt: 1 })
postSchema.index({ deletedAt: 1, createdAt: -1 })
postSchema.index({ deletedAt: 1, isActive: 1, createdAt: -1 })
postSchema.index({ deletedAt: 1, isActive: 1, mediaType: 1, category: 1 })

postSchema.pre('validate', function () {
  const mediaType = this.mediaType || 'image'
  if (mediaType === 'video') {
    if (!this.videoUrl) {
      this.invalidate('videoUrl', 'Video URL is required for video posts')
    }
    if (!Array.isArray(this.imageUrl)) this.imageUrl = []
  } else if (!this.imageUrl || this.imageUrl.length === 0) {
    this.invalidate('imageUrl', 'At least one image URL is required')
  }
})

postSchema.pre('save', function () {
  this.isMultiImage = Array.isArray(this.imageUrl) && this.imageUrl.length > 1
})

postSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate()
  if (update.imageUrl) {
    update.isMultiImage = update.imageUrl.length > 1
  }
})

const Post = mongoose.model('Post', postSchema)

Post.VALID_CATEGORIES = VALID_CATEGORIES
Post.VIDEO_CATEGORIES = VIDEO_CATEGORIES
Post.IMAGE_CATEGORIES = IMAGE_CATEGORIES

module.exports = Post
