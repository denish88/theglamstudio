const mongoose = require('mongoose')

const paymentHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    paymentDate: {
      type: Date,
      required: [true, 'Payment date is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be at least 1'],
    },
    subscriptionType: {
      type: String,
      enum: ['monthly', '3months', 'yearly'],
      required: [true, 'Subscription type is required'],
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR'],
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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

paymentHistorySchema.index({ deletedAt: 1, paymentDate: -1 })
paymentHistorySchema.index({ user: 1, deletedAt: 1, paymentDate: -1 })
paymentHistorySchema.index({ deletedAt: 1, paymentDate: 1 })

const PaymentHistory = mongoose.model('PaymentHistory', paymentHistorySchema)

module.exports = PaymentHistory
