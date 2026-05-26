const mongoose = require('mongoose')

const ratingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: 0,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  {
    timestamps: true,
  },
)

ratingSchema.index({ userId: 1, createdAt: -1 })
ratingSchema.index({ rating: 1, createdAt: -1 })

const Rating = mongoose.model('Rating', ratingSchema)

module.exports = Rating
