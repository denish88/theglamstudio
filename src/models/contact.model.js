const mongoose = require('mongoose')

const contactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: 150,
    },
    subject: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      maxlength: 2000,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

contactSchema.index({ createdAt: -1 })
contactSchema.index({ isRead: 1 })

const Contact = mongoose.model('Contact', contactSchema)

module.exports = Contact
