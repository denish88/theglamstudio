const mongoose = require('mongoose')

const postSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: [String],
      required: [true, 'At least one image URL is required'],
      validate: {
        validator: (v) => v.length > 0,
        message: 'imageUrl must contain at least one URL',
      },
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
      enum: [0, 1, 2, 3, 4, 5],
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

postSchema.pre('save', function () {
  this.isMultiImage = this.imageUrl.length > 1
})

postSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate()
  if (update.imageUrl) {
    update.isMultiImage = update.imageUrl.length > 1
  }
})

const Post = mongoose.model('Post', postSchema)

module.exports = Post
