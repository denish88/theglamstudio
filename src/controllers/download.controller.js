const { User, Post } = require('../models')
const DownloadEvent = require('../models/downloadEvent.model')
const {
  ApiError,
  ApiResponse,
  buildMediaUrl,
  getISTDayBounds,
} = require('../utils')
const {
  getDownloadLimitForPlan,
  buildDownloadQuota,
} = require('../utils/downloadLimits')

function hasActiveSubscription(user, now = new Date()) {
  const endDate = user?.subscription?.endDate
  if (!endDate) return false
  // Align with expiry job: subscription is valid through the IST calendar day of endDate
  const { end: endOfExpiryDay } = getISTDayBounds(new Date(endDate))
  return endOfExpiryDay >= now
}

function resolveQuota(user) {
  const planLimit = getDownloadLimitForPlan(user?.subscription?.type)
  const storedLimit = Number(user?.downloadQuota?.limit)
  const limit = storedLimit > 0 ? storedLimit : planLimit
  // Prefer new `used`; fall back to legacy daily `count` if migrating mid-flight
  const rawUsed = user?.downloadQuota?.used
  const used = Number.isFinite(Number(rawUsed))
    ? Math.max(0, Number(rawUsed))
    : Math.max(0, Number(user?.downloadQuota?.count) || 0)
  return {
    used: Math.min(used, limit),
    limit,
    remaining: Math.max(0, limit - Math.min(used, limit)),
  }
}

function filenameFromKey(key, fallbackIndex = 0) {
  const base = String(key || '').split('/').pop() || `photo-${fallbackIndex + 1}.webp`
  return base.replace(/[^\w.\-]+/g, '_')
}

/**
 * Ensure the user has a subscription-period quota document (used/limit).
 * Migrates legacy { date, count } shape on first touch.
 */
async function ensureSubscriptionQuota(user) {
  const expected = buildDownloadQuota(user.subscription?.type, resolveQuota(user).used)
  const currentLimit = Number(user.downloadQuota?.limit)
  const currentUsed = Number(user.downloadQuota?.used)

  const needsRepair =
    !Number.isFinite(currentLimit) ||
    currentLimit <= 0 ||
    !Number.isFinite(currentUsed) ||
    user.downloadQuota?.date != null

  if (!needsRepair && currentLimit === expected.limit) {
    return user
  }

  // Keep existing used when only repairing shape; always align limit to current plan.
  const next = buildDownloadQuota(
    user.subscription?.type,
    Number.isFinite(currentUsed) ? currentUsed : resolveQuota(user).used,
  )

  const updated = await User.findByIdAndUpdate(
    user._id,
    { $set: { downloadQuota: next } },
    { new: true },
  ).select('downloadEnabled downloadQuota subscription isActive')

  return updated || user
}

/**
 * Atomically consume one download from the subscription allotment.
 */
async function consumeDownloadSlot(userId) {
  return User.findOneAndUpdate(
    {
      _id: userId,
      deletedAt: null,
      isActive: true,
      downloadEnabled: true,
      $expr: {
        $lt: [
          { $ifNull: ['$downloadQuota.used', 0] },
          { $ifNull: ['$downloadQuota.limit', 0] },
        ],
      },
    },
    { $inc: { 'downloadQuota.used': 1 } },
    { new: true },
  ).select('downloadEnabled downloadQuota subscription isActive')
}

function quotaPayload(user, extras = {}) {
  const { used, limit, remaining } = resolveQuota(user)
  const subscriptionActive = hasActiveSubscription(user)
  const downloadEnabled = !!user.downloadEnabled
  const canDownload = downloadEnabled && subscriptionActive && remaining > 0

  return {
    downloadEnabled,
    subscriptionActive,
    canDownload,
    limit,
    used,
    remaining,
    // Backward-compatible aliases for older clients
    usedToday: used,
    remainingToday: remaining,
    plan: user.subscription?.type || null,
    ...extras,
  }
}

const getDownloadQuota = async (req, res, next) => {
  try {
    let user = await User.findById(req.user._id)
      .select('downloadEnabled downloadQuota subscription isActive')

    if (!user || !user.isActive) {
      throw ApiError.forbidden('Account is inactive')
    }

    if (user.downloadEnabled) {
      user = await ensureSubscriptionQuota(user)
    }

    const payload = quotaPayload(user)
    // If download is off or sub inactive, surface zeros for remaining/used display
    if (!payload.downloadEnabled || !payload.subscriptionActive) {
      payload.used = 0
      payload.remaining = 0
      payload.usedToday = 0
      payload.remainingToday = 0
      payload.canDownload = false
    }

    ApiResponse.success(res, payload)
  } catch (error) {
    next(error)
  }
}

/**
 * Authorize + consume quota for downloading a single photo from a post.
 * Returns a same-origin media proxy URL (?proxy=1) for the client to fetch.
 */
const downloadPostPhoto = async (req, res, next) => {
  try {
    const postId = req.params.id
    const rawIndex = req.body?.imageIndex ?? req.query?.imageIndex ?? 0
    const imageIndex = Number.parseInt(rawIndex, 10)

    if (Number.isNaN(imageIndex) || imageIndex < 0) {
      throw ApiError.badRequest('Invalid image index')
    }

    let user = await User.findById(req.user._id)
      .select('downloadEnabled downloadQuota subscription isActive')

    if (!user || !user.isActive) {
      throw ApiError.forbidden('Account is inactive')
    }

    if (!user.downloadEnabled) {
      throw ApiError.forbidden('Photo download is not enabled for your account')
    }

    if (!hasActiveSubscription(user)) {
      throw ApiError.forbidden('Active subscription required to download photos')
    }

    user = await ensureSubscriptionQuota(user)
    const before = resolveQuota(user)
    if (before.remaining <= 0) {
      throw ApiError.tooMany(
        `Download limit reached (${before.limit} photos for this subscription).`,
      )
    }

    const post = await Post.findOne({
      _id: postId,
      deletedAt: null,
      isActive: true,
    }).select('mediaType imageUrl videoUrl caption category directory')

    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const mediaType = post.mediaType || (post.videoUrl ? 'video' : 'image')
    if (mediaType === 'video' || post.videoUrl) {
      throw ApiError.badRequest('Only photos can be downloaded')
    }

    const images = Array.isArray(post.imageUrl) ? post.imageUrl : []
    if (!images.length || imageIndex >= images.length || !images[imageIndex]) {
      throw ApiError.badRequest('Photo not found on this post')
    }

    const imageKey = images[imageIndex]
    if (typeof imageKey !== 'string' || !imageKey.startsWith('posts/')) {
      throw ApiError.badRequest('Invalid photo')
    }

    const updated = await consumeDownloadSlot(user._id)
    if (!updated) {
      throw ApiError.tooMany(
        `Download limit reached (${before.limit} photos for this subscription).`,
      )
    }

    const after = resolveQuota(updated)

    // Audit trail — do not fail the download if logging fails
    try {
      const caption = typeof post.caption === 'string' ? post.caption.trim().slice(0, 200) : ''
      await DownloadEvent.create({
        userId: user._id,
        postId: post._id,
        imageIndex,
        imageKey,
        category: typeof post.category === 'number' ? post.category : null,
        directoryId: post.directory || null,
        caption,
        plan: updated.subscription?.type || user.subscription?.type || null,
        quotaUsedAfter: after.used,
        quotaLimit: after.limit,
      })
    } catch (logError) {
      console.error('[download] failed to log DownloadEvent:', logError?.message || logError)
    }

    const baseUrl = buildMediaUrl(imageKey)
    const mediaUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}proxy=1`

    ApiResponse.success(
      res,
      {
        mediaUrl,
        filename: filenameFromKey(imageKey, imageIndex),
        imageIndex,
        postId: String(post._id),
        ...quotaPayload(updated),
      },
      after.remaining > 0
        ? `Download authorized. ${after.remaining} photo download(s) left in this subscription.`
        : 'Download authorized. Subscription download limit reached.',
    )
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getDownloadQuota,
  downloadPostPhoto,
  getDownloadLimitForPlan,
  buildDownloadQuota,
}
