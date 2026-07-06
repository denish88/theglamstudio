const { User } = require('../models')
const { ApiError, ApiResponse } = require('../utils')
const {
  generateNextMemberKeyId,
  formatMemberKeyIdDisplay,
  getAdminDisplayName,
  validateCollectorName,
} = require('../utils/memberKeyId')

function generatePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let password = ''
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

const listCollectors = async (req, res, next) => {
  try {
    const admins = await User.find({ role: 'admin', deletedAt: null, isActive: true })
      .select('keyId displayName')
      .sort({ displayName: 1, keyId: 1 })
      .lean()

    const collectors = admins.map((admin) => ({
      name: getAdminDisplayName(admin),
      keyId: admin.keyId,
    }))

    ApiResponse.success(res, { collectors })
  } catch (error) {
    next(error)
  }
}

const createUser = async (req, res, next) => {
  try {
    const { subscriptionType, referredByKeyId, collector } = req.body

    const collectorName = await validateCollectorName(collector)
    const createdByAdmin = getAdminDisplayName(req.user)

    const keyId = await generateNextMemberKeyId()
    const plainPassword = generatePassword()

    const subType = subscriptionType || 'monthly'
    const months = { monthly: 1, '3months': 3, yearly: 12 }
    const duration = months[subType] || 1
    const startDate = new Date()
    const endDate = new Date()
    endDate.setMonth(endDate.getMonth() + duration)

    const userData = {
      keyId,
      password: plainPassword,
      role: 'user',
      isActive: true,
      createdByAdmin,
      collector: collectorName,
      subscription: {
        startDate,
        endDate,
        type: subType,
      },
    }

    let referrer = null
    if (referredByKeyId) {
      referrer = await User.findOne({ keyId: referredByKeyId.toLowerCase(), deletedAt: null })
      if (referrer) {
        userData.referredBy = referrer._id
      }
    }

    const user = await User.create(userData)

    if (referrer) {
      const BONUS_DAYS = 5
      const currentEnd = referrer.subscription?.endDate ? new Date(referrer.subscription.endDate) : new Date()
      const baseDate = currentEnd > new Date() ? currentEnd : new Date()
      const newEndDate = new Date(baseDate)
      newEndDate.setDate(newEndDate.getDate() + BONUS_DAYS)

      await User.findByIdAndUpdate(referrer._id, {
        $inc: { referralCount: 1 },
        $set: { 'subscription.endDate': newEndDate },
      })
    }

    ApiResponse.created(res, {
      keyId: user.keyId,
      keyIdDisplay: formatMemberKeyIdDisplay(user.keyId),
      password: plainPassword,
      referralCode: user.referralCode,
      subscription: user.subscription,
      createdByAdmin: user.createdByAdmin,
      collector: user.collector,
    }, 'User created successfully')
  } catch (error) {
    next(error)
  }
}

const listUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const skip = (page - 1) * limit

    const filter = { deletedAt: null }

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true'
    }
    if (req.query.search) {
      filter.keyId = { $regex: req.query.search, $options: 'i' }
    }
    if (req.query.collector) {
      filter.collector = req.query.collector
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ])

    ApiResponse.success(res, {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    next(error)
  }
}

const getUserDetail = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
      .populate('referredBy', 'keyId referralCode')
      .lean()

    if (!user) {
      throw ApiError.notFound('User not found')
    }

    const referredUsers = await User.find({ referredBy: user._id, deletedAt: null })
      .select('keyId isActive subscription.type createdAt')
      .sort({ createdAt: -1 })
      .lean()

    ApiResponse.success(res, { ...user, referredUsers })
  } catch (error) {
    next(error)
  }
}

const getReferralStats = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
      .select('keyId referralCode referralCount')
      .lean()

    if (!user) {
      throw ApiError.notFound('User not found')
    }

    const referredUsers = await User.find({ referredBy: user._id, deletedAt: null })
      .select('keyId isActive subscription.type subscription.endDate createdAt')
      .sort({ createdAt: -1 })
      .lean()

    const activeReferrals = referredUsers.filter((u) => u.isActive).length

    ApiResponse.success(res, {
      keyId: user.keyId,
      referralCode: user.referralCode,
      referralCount: user.referralCount,
      activeReferrals,
      referredUsers,
    })
  } catch (error) {
    next(error)
  }
}

const checkExpiredSubscriptions = async (req, res, next) => {
  try {
    const now = new Date()

    const filter = {
      deletedAt: null,
      role: { $ne: 'admin' },
      isActive: true,
      'subscription.endDate': { $ne: null, $lt: now },
    }

    const expiredUsers = await User.find(filter)
      .select('keyId subscription.endDate')
      .lean()

    if (expiredUsers.length === 0) {
      return ApiResponse.success(res, {
        deactivatedCount: 0,
        deactivatedUsers: [],
        checkedAt: now,
      }, 'No expired subscriptions found')
    }

    await User.updateMany(filter, {
      $set: {
        isActive: false,
        refreshToken: null,
        deviceId: null,
      },
    })

    ApiResponse.success(res, {
      deactivatedCount: expiredUsers.length,
      deactivatedUsers: expiredUsers.map((u) => ({
        id: u._id,
        keyId: u.keyId,
        subscriptionEndDate: u.subscription?.endDate,
      })),
      checkedAt: now,
    }, `${expiredUsers.length} user(s) deactivated due to expired subscription`)
  } catch (error) {
    next(error)
  }
}

const toggleUserActive = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    user.isActive = !user.isActive
    await user.save({ validateBeforeSave: false })

    ApiResponse.success(res, { isActive: user.isActive }, `User ${user.isActive ? 'activated' : 'deactivated'}`)
  } catch (error) {
    next(error)
  }
}

const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    user.deletedAt = new Date()
    user.isActive = false
    await user.save({ validateBeforeSave: false })

    ApiResponse.success(res, null, 'User deleted')
  } catch (error) {
    next(error)
  }
}

const updateUserPoints = async (req, res, next) => {
  try {
    const { points } = req.body

    if (points === undefined || points === null) {
      throw ApiError.badRequest('Points value is required')
    }

    const parsedPoints = Number(points)
    if (isNaN(parsedPoints) || parsedPoints < 0) {
      throw ApiError.badRequest('Points must be a non-negative number')
    }

    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    user.points = parsedPoints
    await user.save({ validateBeforeSave: false })

    ApiResponse.success(res, { points: user.points }, 'Points updated successfully')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  listCollectors,
  createUser,
  listUsers,
  getUserDetail,
  getReferralStats,
  checkExpiredSubscriptions,
  toggleUserActive,
  deleteUser,
  updateUserPoints,
}
