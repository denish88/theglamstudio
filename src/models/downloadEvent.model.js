const mongoose = require('mongoose')

/**
 * One row per successful photo download (after quota is consumed).
 * Lets admins see which member downloaded which image and when.
 */
const downloadEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    imageIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    imageKey: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: Number,
      default: null,
    },
    directoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Directory',
      default: null,
    },
    caption: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    plan: {
      type: String,
      enum: ['monthly', '3months', 'yearly', null],
      default: null,
    },
    quotaUsedAfter: {
      type: Number,
      default: null,
      min: 0,
    },
    quotaLimit: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
)

downloadEventSchema.index({ createdAt: -1 })
downloadEventSchema.index({ userId: 1, createdAt: -1 })
downloadEventSchema.index({ postId: 1, createdAt: -1 })

const DownloadEvent = mongoose.model('DownloadEvent', downloadEventSchema)

module.exports = DownloadEvent
