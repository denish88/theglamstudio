const { Rating } = require('../models')
const { ApiResponse, ApiError } = require('../utils')

const submitRating = async (req, res, next) => {
  try {
    const { rating, comment } = req.body

    if (rating === undefined || rating === null) {
      throw ApiError.badRequest('Rating is required')
    }

    const ratingVal = Number(rating)
    if (isNaN(ratingVal) || ratingVal < 0 || ratingVal > 5) {
      throw ApiError.badRequest('Rating must be between 0 and 5')
    }

    const newRating = await Rating.create({
      userId: req.user._id,
      rating: ratingVal,
      comment: comment?.trim() || '',
    })

    return ApiResponse.created(res, { id: newRating._id }, 'Rating submitted successfully')
  } catch (error) {
    next(error)
  }
}

const getMyRatings = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const [ratings, total] = await Promise.all([
      Rating.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Rating.countDocuments({ userId: req.user._id }),
    ])

    return ApiResponse.success(res, {
      ratings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    next(error)
  }
}

const listAllRatings = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20))
    const skip = (page - 1) * limit
    const ratingFilter = parseInt(req.query.rating)

    const query = {}
    if (!isNaN(ratingFilter) && ratingFilter >= 0 && ratingFilter <= 5) {
      query.rating = ratingFilter
    }

    const [ratings, total, avgResult] = await Promise.all([
      Rating.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'keyId')
        .lean(),
      Rating.countDocuments(query),
      Rating.aggregate([
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ])

    const stats = avgResult[0] || { avg: 0, count: 0 }

    const distribution = await Rating.aggregate([
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ])

    const ratingDistribution = {}
    for (let i = 0; i <= 5; i++) {
      const found = distribution.find((d) => d._id === i)
      ratingDistribution[i] = found ? found.count : 0
    }

    return ApiResponse.success(res, {
      ratings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      stats: {
        average: Math.round(stats.avg * 10) / 10,
        total: stats.count,
        distribution: ratingDistribution,
      },
    })
  } catch (error) {
    next(error)
  }
}

const deleteRating = async (req, res, next) => {
  try {
    const rating = await Rating.findByIdAndDelete(req.params.id)
    if (!rating) {
      throw ApiError.notFound('Rating not found')
    }
    return ApiResponse.success(res, null, 'Rating deleted')
  } catch (error) {
    next(error)
  }
}

module.exports = { submitRating, getMyRatings, listAllRatings, deleteRating }
