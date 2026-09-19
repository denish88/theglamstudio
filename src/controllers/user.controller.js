const { User } = require('../models')
const crypto = require('crypto')
const { FRONTEND_URL } = require('../config/env')
const {
  ApiError,
  ApiResponse,
  generatePasswordResetToken,
  getISTDayBounds,
} = require('../utils')
const {
  generateNextMemberKeyId,
  formatMemberKeyIdDisplay,
  getAdminDisplayName,
  normalizeKeyId,
  validateCollectorName,
} = require('../utils/memberKeyId')
const {
  normalizeIp,
  lookupIpLocations,
  formatLocationLabel,
} = require('../utils/ipGeo')
const { buildDownloadQuota, getDownloadLimitForPlan } = require('../utils/downloadLimits')

const ALLOWED_SUBSCRIPTION_TYPES = ['monthly', '3months', 'yearly']
const SUBSCRIPTION_MONTHS = { monthly: 1, '3months': 3, yearly: 12 }
const PLAN_LABELS = { monthly: 'Monthly', '3months': '3 Months', yearly: 'Yearly' }

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let password = ''
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

/** End date = startDate + plan duration (calendar months, same as create). */
function computeSubscriptionEndDate(startDate, subscriptionType) {
  const duration = SUBSCRIPTION_MONTHS[subscriptionType] || 1
  const endDate = new Date(startDate)
  endDate.setMonth(endDate.getMonth() + duration)
  return endDate
}

/**
 * Shared member-create logic for admin panel and open API-key clients.
 */
async function createMemberUser({
  collector,
  subscriptionType,
  referredByKeyId,
  downloadEnabled,
  createdByAdmin,
}) {
  const collectorName = await validateCollectorName(collector)

  const subType = subscriptionType || 'monthly'
  if (!ALLOWED_SUBSCRIPTION_TYPES.includes(subType)) {
    throw ApiError.badRequest('subscriptionType must be monthly, 3months, or yearly')
  }

  const keyId = await generateNextMemberKeyId()
  const plainPassword = generatePassword()

  const startDate = new Date()
  const endDate = computeSubscriptionEndDate(startDate, subType)

  const enabled = downloadEnabled === true || downloadEnabled === 'true'

  const userData = {
    keyId,
    password: plainPassword,
    role: 'user',
    isActive: true,
    downloadEnabled: enabled,
    createdByAdmin,
    collector: collectorName,
    subscription: {
      startDate,
      endDate,
      type: subType,
    },
  }

  if (enabled) {
    userData.downloadQuota = buildDownloadQuota(subType, 0)
  }

  let referrer = null
  if (referredByKeyId) {
    referrer = await User.findOne({ keyId: normalizeKeyId(referredByKeyId), deletedAt: null })
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

  return {
    keyId: user.keyId,
    keyIdDisplay: formatMemberKeyIdDisplay(user.keyId),
    password: plainPassword,
    referralCode: user.referralCode,
    subscription: user.subscription,
    createdByAdmin: user.createdByAdmin,
    collector: user.collector,
    downloadEnabled: !!user.downloadEnabled,
  }
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
    const { subscriptionType, referredByKeyId, collector, downloadEnabled } = req.body
    const data = await createMemberUser({
      collector,
      subscriptionType,
      referredByKeyId,
      downloadEnabled,
      createdByAdmin: getAdminDisplayName(req.user),
    })
    ApiResponse.created(res, data, 'User created successfully')
  } catch (error) {
    next(error)
  }
}

/**
 * Open API (API-key) create user — same result as admin create.
 * createdByAdmin is recorded as "Open API" unless `createdBy` is provided.
 */
const createUserViaApiKey = async (req, res, next) => {
  try {
    const {
      subscriptionType,
      referredByKeyId,
      collector,
      downloadEnabled,
      createdBy,
    } = req.body

    const createdByAdmin = (typeof createdBy === 'string' && createdBy.trim())
      ? createdBy.trim().slice(0, 80)
      : 'Open API'

    const data = await createMemberUser({
      collector,
      subscriptionType,
      referredByKeyId,
      downloadEnabled,
      createdByAdmin,
    })

    ApiResponse.created(res, data, 'User created successfully')
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

    const [users, total, statsAgg] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
      User.aggregate([
        { $match: { deletedAt: null } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 0, 1] } },
            admins: { $sum: { $cond: [{ $eq: ['$role', 'admin'] }, 1, 0] } },
          },
        },
      ]),
    ])

    const totals = statsAgg[0] || { total: 0, active: 0, inactive: 0, admins: 0 }

    ApiResponse.success(res, {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        total: totals.total || 0,
        active: totals.active || 0,
        inactive: totals.inactive || 0,
        admins: totals.admins || 0,
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
    // Date-only expiry (IST): if endDate falls on today or earlier, deactivate —
    // ignore the time portion of endDate / current time.
    const { end: endOfTodayIst } = getISTDayBounds(now)

    const filter = {
      deletedAt: null,
      role: { $ne: 'admin' },
      isActive: true,
      'subscription.endDate': { $ne: null, $lte: endOfTodayIst },
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

const toggleUserDownload = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (user.role === 'admin') {
      throw ApiError.badRequest('Download permission does not apply to admin accounts')
    }

    user.downloadEnabled = !user.downloadEnabled
    if (user.downloadEnabled) {
      // Fresh allotment for the current plan whenever download is turned on
      user.downloadQuota = buildDownloadQuota(user.subscription?.type, 0)
    }
    await user.save({ validateBeforeSave: false })

    const limit = user.downloadEnabled
      ? (user.downloadQuota?.limit || getDownloadLimitForPlan(user.subscription?.type))
      : 0

    ApiResponse.success(
      res,
      {
        downloadEnabled: !!user.downloadEnabled,
        downloadQuota: user.downloadEnabled
          ? { used: 0, limit }
          : user.downloadQuota,
      },
      user.downloadEnabled
        ? `Photo download enabled (${limit} photos for this subscription)`
        : 'Photo download disabled',
    )
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

/**
 * Change a member's subscription plan.
 * Keeps the existing startDate (unless a valid startDate is sent) and
 * recalculates endDate from that start + plan duration.
 * Download quota limit is adjusted to the new plan when download is enabled.
 */
const updateUserSubscription = async (req, res, next) => {
  try {
    const { subscriptionType, startDate: startDateInput } = req.body

    if (!subscriptionType || !ALLOWED_SUBSCRIPTION_TYPES.includes(subscriptionType)) {
      throw ApiError.badRequest('subscriptionType must be monthly, 3months, or yearly')
    }

    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (user.role === 'admin') {
      throw ApiError.badRequest('Subscription does not apply to admin accounts')
    }

    let startDate
    if (startDateInput) {
      startDate = new Date(startDateInput)
      if (Number.isNaN(startDate.getTime())) {
        throw ApiError.badRequest('startDate must be a valid date')
      }
    } else if (user.subscription?.startDate) {
      startDate = new Date(user.subscription.startDate)
    } else {
      startDate = new Date()
    }

    const endDate = computeSubscriptionEndDate(startDate, subscriptionType)

    user.subscription = {
      startDate,
      endDate,
      type: subscriptionType,
    }

    if (user.downloadEnabled) {
      const used = user.downloadQuota?.used || 0
      user.downloadQuota = buildDownloadQuota(subscriptionType, used)
    }

    await user.save({ validateBeforeSave: false })

    const isSubActive = endDate > new Date()

    ApiResponse.success(
      res,
      {
        subscription: {
          plan: PLAN_LABELS[subscriptionType] || 'Free',
          status: isSubActive ? 'active' : 'expired',
          startDate,
          endDate,
          type: subscriptionType,
        },
        downloadQuota: user.downloadEnabled ? user.downloadQuota : undefined,
      },
      `Subscription updated to ${PLAN_LABELS[subscriptionType]}`,
    )
  } catch (error) {
    next(error)
  }
}

/**
 * Collect unique login IPs for a user and resolve approximate locations.
 */
const getUserLocations = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null })
      .select('keyId ipAddress ipDetails loginActivity')
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    const activity = Array.isArray(user.loginActivity) ? user.loginActivity : []
    const ipMap = new Map()

    const bump = (rawIp, timestamp) => {
      const ip = normalizeIp(rawIp)
      if (!ip) return
      const ts = timestamp ? new Date(timestamp).getTime() : 0
      const existing = ipMap.get(ip)
      if (existing) {
        existing.count += 1
        if (ts > existing.lastSeenTs) existing.lastSeenTs = ts
      } else {
        ipMap.set(ip, { ip, count: 1, lastSeenTs: ts })
      }
    }

    for (const entry of activity) {
      bump(entry?.ipAddress, entry?.timestamp)
    }

    const currentIp = normalizeIp(user.ipAddress)
    if (currentIp && !ipMap.has(currentIp)) {
      bump(currentIp, null)
    }

    const ips = Array.from(ipMap.keys())
    if (ips.length === 0) {
      return ApiResponse.success(res, {
        keyId: formatMemberKeyIdDisplay(user.keyId) || user.keyId,
        currentIp: null,
        locations: [],
      })
    }

    const { geoByIp, updatedCache } = await lookupIpLocations(ips, user.ipDetails || {})

    const cacheChanged = JSON.stringify(user.ipDetails || {}) !== JSON.stringify(updatedCache)
    if (cacheChanged) {
      user.ipDetails = updatedCache
      await user.save({ validateBeforeSave: false })
    }

    const locations = Array.from(ipMap.values())
      .sort((a, b) => b.count - a.count || b.lastSeenTs - a.lastSeenTs)
      .map((item) => {
        const geo = geoByIp[item.ip] || null
        return {
          ip: item.ip,
          count: item.count,
          lastSeen: item.lastSeenTs ? new Date(item.lastSeenTs) : null,
          isCurrent: item.ip === currentIp,
          location: formatLocationLabel(geo),
          geo: geo
            ? {
                status: geo.status,
                message: geo.message || null,
                city: geo.city,
                region: geo.region,
                country: geo.country,
                countryCode: geo.countryCode,
                zip: geo.zip,
                lat: geo.lat,
                lon: geo.lon,
                isp: geo.isp,
                org: geo.org,
                asn: geo.asn ?? null,
                timezone: geo.timezone,
              }
            : null,
        }
      })

    ApiResponse.success(res, {
      keyId: formatMemberKeyIdDisplay(user.keyId) || user.keyId,
      currentIp,
      locations,
    })
  } catch (error) {
    if (error?.message?.includes('IP geolocation')) {
      return next(ApiError.internal(error.message))
    }
    next(error)
  }
}

/**
 * Admin generates a one-time password reset link (JWT valid 10 minutes).
 */
const createPasswordResetLink = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null }).select(
      '+passwordResetNonce',
    )
    if (!user) {
      throw ApiError.notFound('User not found')
    }

    if (user.role === 'admin' && String(user._id) === String(req.user._id)) {
      throw ApiError.badRequest('Use Settings to change your own password')
    }

    const nonce = crypto.randomBytes(24).toString('hex')
    user.passwordResetNonce = nonce
    await user.save({ validateBeforeSave: false })

    const token = generatePasswordResetToken(user._id, user.keyId, nonce)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const base = String(FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`

    ApiResponse.success(
      res,
      {
        resetUrl,
        expiresAt,
        keyId: formatMemberKeyIdDisplay(user.keyId) || user.keyId,
        expiresInMinutes: 10,
      },
      'Password reset link created (valid for 10 minutes)',
    )
  } catch (error) {
    next(error)
  }
}

module.exports = {
  listCollectors,
  createUser,
  createUserViaApiKey,
  listUsers,
  getUserDetail,
  getUserLocations,
  getReferralStats,
  checkExpiredSubscriptions,
  toggleUserActive,
  toggleUserDownload,
  deleteUser,
  updateUserPoints,
  updateUserSubscription,
  createPasswordResetLink,
}
