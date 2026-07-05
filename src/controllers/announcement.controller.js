const Announcement = require('../models/announcement.model')
const { SITE_ANNOUNCEMENT_KEY } = require('../models/announcement.model')
const { ApiResponse, ApiError } = require('../utils')
const { getHomeStats, invalidateHomeStats } = require('../utils/homeStats')

const getSiteAnnouncement = async () => {
  let announcement = await Announcement.findOne({
    singletonKey: SITE_ANNOUNCEMENT_KEY,
    deletedAt: null,
  })

  if (announcement) return announcement

  const legacy = await Announcement.findOne({
    deletedAt: null,
    $or: [{ singletonKey: { $exists: false } }, { singletonKey: null }],
  }).sort({ updatedAt: -1 })

  if (!legacy) return null

  legacy.singletonKey = SITE_ANNOUNCEMENT_KEY
  await legacy.save()

  await Announcement.updateMany(
    { _id: { $ne: legacy._id }, deletedAt: null },
    { deletedAt: new Date(), isActive: false },
  )

  return legacy
}

const getAnnouncement = async (req, res, next) => {
  try {
    const announcement = await getSiteAnnouncement()

    return ApiResponse.success(res, {
      announcement: announcement
        ? { text: announcement.text, isActive: announcement.isActive, updatedAt: announcement.updatedAt }
        : { text: '', isActive: false, updatedAt: null },
    })
  } catch (error) {
    next(error)
  }
}

const saveAnnouncement = async (req, res, next) => {
  try {
    const { text, isActive } = req.body
    const trimmedText = typeof text === 'string' ? text.trim() : ''
    const active = !!isActive

    if (active && !trimmedText) {
      throw ApiError.badRequest('Announcement text is required when showing on home screen')
    }

    const announcement = await Announcement.findOneAndUpdate(
      { singletonKey: SITE_ANNOUNCEMENT_KEY, deletedAt: null },
      {
        $set: {
          text: trimmedText,
          isActive: active,
          singletonKey: SITE_ANNOUNCEMENT_KEY,
          deletedAt: null,
        },
      },
      { new: true, upsert: true, runValidators: true },
    )

    await Announcement.updateMany(
      {
        deletedAt: null,
        _id: { $ne: announcement._id },
      },
      { deletedAt: new Date(), isActive: false },
    )

    invalidateHomeStats()

    return ApiResponse.success(
      res,
      {
        text: announcement.text,
        isActive: announcement.isActive,
        updatedAt: announcement.updatedAt,
      },
      active ? 'Announcement is now live on home screen' : 'Announcement saved',
    )
  } catch (error) {
    next(error)
  }
}

const getActiveAnnouncement = async (req, res, next) => {
  try {
    const stats = await getHomeStats()

    return ApiResponse.success(res, {
      announcement: stats.announcement,
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getAnnouncement,
  saveAnnouncement,
  getActiveAnnouncement,
}
