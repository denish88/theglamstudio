const { User, Post } = require('../models')
const { ApiError, ApiResponse, buildMediaUrl, getISTDateKey, getISTDayBounds } = require('../utils')

const DAILY_PHOTO_DOWNLOAD_LIMIT = 2

function hasActiveSubscription(user, now = new Date()) {
  const endDate = user?.subscription?.endDate
  if (!endDate) return false
  // Align with expiry job: subscription is valid through the IST calendar day of endDate
  const { end: endOfExpiryDay } = getISTDayBounds(new Date(endDate))
  return endOfExpiryDay >= now
}

function getUsedToday(user, dateKey) {
  if (!user?.downloadQuota?.date || user.downloadQuota.date !== dateKey) return 0
  return Number(user.downloadQuota.count) || 0
}

function filenameFromKey(key, fallbackIndex = 0) {
  const base = String(key || '').split('/').pop() || `photo-${fallbackIndex + 1}.webp`
  return base.replace(/[^\w.\-]+/g, '_')
}

/**
 * Consume one daily download slot. Uses classic updates (no aggregation pipeline)
 * so it works across Mongoose versions without updatePipeline.
 */
async function consumeDownloadSlot(userId, dateKey) {
  const baseFilter = {
    _id: userId,
    deletedAt: null,
    isActive: true,
    downloadEnabled: true,
  }

  // Same calendar day — increment if under limit
  const sameDay = await User.findOneAndUpdate(
    {
      ...baseFilter,
      'downloadQuota.date': dateKey,
      'downloadQuota.count': { $lt: DAILY_PHOTO_DOWNLOAD_LIMIT },
    },
    { $inc: { 'downloadQuota.count': 1 } },
    { new: true },
  )
  if (sameDay) return sameDay

  // New day (or first download ever) — reset quota to 1
  const rolled = await User.findOneAndUpdate(
    {
      ...baseFilter,
      $or: [
        { 'downloadQuota.date': { $ne: dateKey } },
        { 'downloadQuota.date': null },
        { 'downloadQuota.date': { $exists: false } },
      ],
    },
    {
      $set: {
        downloadQuota: {
          date: dateKey,
          count: 1,
        },
      },
    },
    { new: true },
  )
  if (rolled) return rolled

  // Concurrent day-rollover: another request already set today's date — retry increment
  return User.findOneAndUpdate(
    {
      ...baseFilter,
      'downloadQuota.date': dateKey,
      'downloadQuota.count': { $lt: DAILY_PHOTO_DOWNLOAD_LIMIT },
    },
    { $inc: { 'downloadQuota.count': 1 } },
    { new: true },
  )
}

const getDownloadQuota = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('downloadEnabled downloadQuota subscription isActive')
      .lean()

    if (!user || !user.isActive) {
      throw ApiError.forbidden('Account is inactive')
    }

    const dateKey = getISTDateKey()
    const usedToday = getUsedToday(user, dateKey)
    const enabled = !!user.downloadEnabled && hasActiveSubscription(user)

    ApiResponse.success(res, {
      downloadEnabled: !!user.downloadEnabled,
      subscriptionActive: hasActiveSubscription(user),
      canDownload: enabled && usedToday < DAILY_PHOTO_DOWNLOAD_LIMIT,
      limit: DAILY_PHOTO_DOWNLOAD_LIMIT,
      usedToday: enabled ? usedToday : 0,
      remainingToday: enabled ? Math.max(0, DAILY_PHOTO_DOWNLOAD_LIMIT - usedToday) : 0,
      dateKey,
    })
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

    const user = await User.findById(req.user._id)
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

    const dateKey = getISTDateKey()
    const usedBefore = getUsedToday(user, dateKey)
    if (usedBefore >= DAILY_PHOTO_DOWNLOAD_LIMIT) {
      throw ApiError.tooMany(
        `Daily download limit reached (${DAILY_PHOTO_DOWNLOAD_LIMIT} photos per day). Try again tomorrow.`,
      )
    }

    const post = await Post.findOne({
      _id: postId,
      deletedAt: null,
      isActive: true,
    }).select('mediaType imageUrl videoUrl')

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

    const updated = await consumeDownloadSlot(user._id, dateKey)
    if (!updated) {
      throw ApiError.tooMany(
        `Daily download limit reached (${DAILY_PHOTO_DOWNLOAD_LIMIT} photos per day). Try again tomorrow.`,
      )
    }

    const usedToday = getUsedToday(updated, dateKey)
    const remainingToday = Math.max(0, DAILY_PHOTO_DOWNLOAD_LIMIT - usedToday)
    const baseUrl = buildMediaUrl(imageKey)
    const mediaUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}proxy=1`

    ApiResponse.success(res, {
      mediaUrl,
      filename: filenameFromKey(imageKey, imageIndex),
      imageIndex,
      postId: String(post._id),
      usedToday,
      remainingToday,
      limit: DAILY_PHOTO_DOWNLOAD_LIMIT,
    }, remainingToday > 0
      ? `Download authorized. ${remainingToday} photo download(s) left today.`
      : 'Download authorized. Daily limit reached.')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getDownloadQuota,
  downloadPostPhoto,
  DAILY_PHOTO_DOWNLOAD_LIMIT,
}
