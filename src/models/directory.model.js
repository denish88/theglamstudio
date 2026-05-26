const mongoose = require('mongoose')

const directorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Directory name is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    totalPictures: {
      type: Number,
      default: 0,
      min: 0,
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

directorySchema.index({ deletedAt: 1, createdAt: -1 })

const Directory = mongoose.model('Directory', directorySchema)

module.exports = Directory
