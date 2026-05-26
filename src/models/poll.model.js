const mongoose = require('mongoose')

const pollOptionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    votes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: true },
)

const pollSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: [true, 'Poll question is required'],
      trim: true,
      maxlength: 500,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    options: {
      type: [pollOptionSchema],
      validate: {
        validator: (v) => v.length >= 2,
        message: 'Poll must have at least 2 options',
      },
    },
    totalVotes: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: false,
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

pollSchema.index({ isActive: 1, deletedAt: 1, createdAt: -1 })
pollSchema.index({ deletedAt: 1, createdAt: -1 })

const Poll = mongoose.model('Poll', pollSchema)

module.exports = Poll
