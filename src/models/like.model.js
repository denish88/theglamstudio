const mongoose = require('mongoose')

const likeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
  },
  {
    timestamps: true,
  },
)

likeSchema.index({ user: 1, post: 1 }, { unique: true })
likeSchema.index({ user: 1, _id: -1 })
likeSchema.index({ post: 1 })

const Like = mongoose.model('Like', likeSchema)

module.exports = Like
