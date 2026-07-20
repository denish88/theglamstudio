const { Post } = require('../models')
const Announcement = require('../models/announcement.model')
const { SITE_ANNOUNCEMENT_KEY } = require('../models/announcement.model')
const simpleCache = require('./simpleCache')

const HOME_STATS_CACHE_KEY = 'feed:home:stats'
const HOME_STATS_TTL_MS = 60 * 1000

async function fetchActiveAnnouncement() {
  const primary = await Announcement.findOne({
    singletonKey: SITE_ANNOUNCEMENT_KEY,
    isActive: true,
    deletedAt: null,
  })
    .select('text updatedAt')
    .lean()

  if (primary?.text?.trim()) {
    return { text: primary.text, updatedAt: primary.updatedAt }
  }

  const legacy = await Announcement.findOne({
    isActive: true,
    deletedAt: null,
    text: { $ne: '' },
  })
    .sort({ updatedAt: -1 })
    .select('text updatedAt')
    .lean()

  if (!legacy?.text?.trim()) return null

  return { text: legacy.text, updatedAt: legacy.updatedAt }
}

async function fetchHomeStats() {
  const [postAgg, announcement] = await Promise.all([
    Post.aggregate([
      { $match: { deletedAt: null, isActive: true } },
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          totalPhotos: {
            $sum: {
              $cond: [
                { $isArray: '$imageUrl' },
                { $size: '$imageUrl' },
                0,
              ],
            },
          },
        },
      },
    ]),
    fetchActiveAnnouncement(),
  ])

  const totals = postAgg[0] || { totalPosts: 0, totalPhotos: 0 }

  return {
    totalPosts: totals.totalPosts || 0,
    totalPhotos: totals.totalPhotos || 0,
    announcement,
  }
}

function getHomeStats() {
  return simpleCache.get(HOME_STATS_CACHE_KEY, HOME_STATS_TTL_MS, fetchHomeStats)
}

function invalidateHomeStats() {
  simpleCache.invalidate(HOME_STATS_CACHE_KEY)
}

module.exports = {
  getHomeStats,
  invalidateHomeStats,
  HOME_STATS_CACHE_KEY,
  HOME_STATS_TTL_MS,
}
