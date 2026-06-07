const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 10; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

const loginActivitySchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now },
    ipAddress: { type: String, default: null },
    browserFingerprint: { type: String, default: null },
  },
  { _id: false },
)

const userSchema = new mongoose.Schema(
  {
    keyId: {
      type: String,
      required: [true, 'Key ID is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    deviceId: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    ipDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    subscription: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      type: {
        type: String,
        enum: ['monthly', '3months', 'yearly', null],
        default: null,
      },
    },
    referralCode: {
      type: String,
      unique: true,
      default: generateReferralCode,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    referralCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    points: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    ageConsentConfirmed: {
      type: Boolean,
      default: false,
    },
    ageConsentConfirmedAt: {
      type: Date,
      default: null,
    },
    loginActivity: {
      type: [loginActivitySchema],
      default: [],
    },
    refreshToken: {
      type: String,
      select: false,
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

userSchema.index({ deletedAt: 1, isActive: 1, createdAt: -1 })
userSchema.index({ referredBy: 1 })

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, 12)
})

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

userSchema.methods.addLoginActivity = function (ipAddress, browserFingerprint) {
  this.loginActivity.unshift({
    timestamp: new Date(),
    ipAddress,
    browserFingerprint,
  })
  if (this.loginActivity.length > 10) {
    this.loginActivity = this.loginActivity.slice(0, 10)
  }
}

userSchema.methods.toSafeObject = function () {
  const sub = this.subscription || {}
  const now = new Date()
  const isSubActive = sub.endDate && new Date(sub.endDate) > now

  const planLabels = { monthly: 'Monthly', '3months': '3 Months', yearly: 'Yearly' }

  return {
    id: this._id,
    keyId: this.keyId,
    role: this.role,
    subscription: {
      plan: planLabels[sub.type] || 'Free',
      status: isSubActive ? 'active' : 'expired',
      startDate: sub.startDate,
      endDate: sub.endDate,
      type: sub.type,
    },
    referralCode: this.referralCode,
    referralCount: this.referralCount,
    points: this.points || 0,
    isReferralApplied: !!this.referredBy,
    isActive: this.isActive,
    ageConsentConfirmed: !!this.ageConsentConfirmed,
    ageConsentConfirmedAt: this.ageConsentConfirmedAt || null,
  }
}

const User = mongoose.model('User', userSchema)

module.exports = User
