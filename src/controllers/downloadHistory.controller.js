const { DownloadEvent, User } = require('../models')
const { ApiResponse, ApiError, buildMediaUrl } = require('../utils')

/**
 * Admin: paginated download history with optional keyId search + date range.
 */
const listDownloadEvents = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const skip = (page - 1) * limit

    const filter = {}

    if (req.query.userId) {
      filter.userId = req.query.userId
    }

    if (req.query.search) {
      const users = await User.find({
        keyId: { $regex: String(req.query.search).trim(), $options: 'i' },
        deletedAt: null,
      })
        .select('_id')
        .limit(50)
        .lean()

      const ids = users.map((u) => u._id)
      if (ids.length === 0) {
        return ApiResponse.success(res, {
          downloads: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
          stats: { total: 0, today: 0 },
        })
      }
      filter.userId = { $in: ids }
    }

    if (req.query.from || req.query.to) {
      filter.createdAt = {}
      if (req.query.from) {
        const from = new Date(req.query.from)
        if (!Number.isNaN(from.getTime())) filter.createdAt.$gte = from
      }
      if (req.query.to) {
        const to = new Date(req.query.to)
        if (!Number.isNaN(to.getTime())) filter.createdAt.$lte = to
      }
      if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt
    }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const [rows, total, today, allTime] = await Promise.all([
      DownloadEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'keyId role')
        .populate('directoryId', 'name')
        .lean(),
      DownloadEvent.countDocuments(filter),
      DownloadEvent.countDocuments({ createdAt: { $gte: startOfToday } }),
      DownloadEvent.countDocuments({}),
    ])

    const downloads = rows.map((row) => ({
      id: row._id,
      createdAt: row.createdAt,
      imageIndex: row.imageIndex,
      imageKey: row.imageKey,
      imageUrl: row.imageKey ? buildMediaUrl(row.imageKey) : null,
      category: row.category,
      caption: row.caption || '',
      plan: row.plan,
      quotaUsedAfter: row.quotaUsedAfter,
      quotaLimit: row.quotaLimit,
      postId: row.postId,
      user: row.userId
        ? { id: row.userId._id, keyId: row.userId.keyId, role: row.userId.role }
        : null,
      directory: row.directoryId
        ? { id: row.directoryId._id, name: row.directoryId.name }
        : null,
    }))

    return ApiResponse.success(res, {
      downloads,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      stats: {
        total: allTime,
        today,
      },
    })
  } catch (error) {
    next(error)
  }
}

const deleteDownloadEvent = async (req, res, next) => {
  try {
    const deleted = await DownloadEvent.findByIdAndDelete(req.params.id)
    if (!deleted) {
      throw ApiError.notFound('Download record not found')
    }
    return ApiResponse.success(res, null, 'Download record removed')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  listDownloadEvents,
  deleteDownloadEvent,
}
