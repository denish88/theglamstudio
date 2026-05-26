const { User } = require('../models')
const { ApiError, ApiResponse } = require('../utils')

const applyReferralCode = async (req, res, next) => {
  try {
    const { referralCode } = req.body
    const userId = req.user._id

    if (!referralCode || !referralCode.trim()) {
      throw ApiError.badRequest('Referral code is required')
    }

    const user = await User.findOne({ _id: userId, deletedAt: null })
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (user.referredBy) {
      throw ApiError.badRequest('You have already applied a referral code')
    }

    const referrer = await User.findOne({
      referralCode: referralCode.trim().toUpperCase(),
      deletedAt: null,
    })

    if (!referrer) {
      throw ApiError.notFound('Invalid referral code')
    }

    if (referrer._id.toString() === userId.toString()) {
      throw ApiError.badRequest('You cannot use your own referral code')
    }

    const BONUS_POINTS = 5
    user.referredBy = referrer._id
    user.points = (user.points || 0) + BONUS_POINTS
    await user.save({ validateBeforeSave: false })

    const BONUS_DAYS = 5
    const currentEnd = referrer.subscription?.endDate ? new Date(referrer.subscription.endDate) : new Date()
    const baseDate = currentEnd > new Date() ? currentEnd : new Date()
    const newEndDate = new Date(baseDate)
    newEndDate.setDate(newEndDate.getDate() + BONUS_DAYS)

    await User.findByIdAndUpdate(referrer._id, {
      $inc: { referralCount: 1 },
      $set: { 'subscription.endDate': newEndDate },
    })

    ApiResponse.success(res, {
      referredBy: referrer.keyId,
      pointsEarned: BONUS_POINTS,
      totalPoints: user.points,
    }, `Referral code applied! You earned ${BONUS_POINTS} points`)
  } catch (error) {
    next(error)
  }
}

const getMyReferrals = async (req, res, next) => {
  try {
    const userId = req.user._id

    const user = await User.findOne({ _id: userId, deletedAt: null })
      .select('keyId referralCode referralCount')
      .lean()

    if (!user) {
      throw ApiError.notFound('User not found')
    }

    const referredUsers = await User.find({ referredBy: userId, deletedAt: null })
      .select('keyId createdAt')
      .sort({ createdAt: -1 })
      .lean()

    ApiResponse.success(res, {
      referralCode: user.referralCode,
      referralCount: user.referralCount,
      referredUsers,
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  applyReferralCode,
  getMyReferrals,
}
