const mongoose = require('mongoose')

const pushSubscriptionSchema = new mongoose.Schema(
  {
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
      maxlength: 512,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'push_subscriptions',
  },
)

pushSubscriptionSchema.index({ updatedAt: -1 })

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema)
