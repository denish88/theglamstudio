const mongoose = require('mongoose')

const requestSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name1: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [40, 'Name cannot exceed 40 characters'],
    },
    name2: {
      type: String,
      required: [true, 'Second name is required'],
      trim: true,
      maxlength: [40, 'Name cannot exceed 40 characters'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved'],
      default: 'pending',
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    /** Ties this request to one Sunday open window (one submit per member per window) */
    sessionWindowId: {
      type: Number,
      default: null,
      index: true,
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

requestSessionSchema.index({ deletedAt: 1, createdAt: -1 })
requestSessionSchema.index({ status: 1, deletedAt: 1, createdAt: -1 })
requestSessionSchema.index(
  { userId: 1, sessionWindowId: 1, deletedAt: 1 },
  { name: 'user_window_lookup' },
)

const RequestSession = mongoose.model('RequestSession', requestSessionSchema)

module.exports = RequestSession
