const { PaymentHistory, User } = require('../models')
const { ApiResponse, ApiError } = require('../utils')
const { getISTMonthBounds } = require('../utils/date')
const { getAdminDisplayName, validateCollectorName } = require('../utils/memberKeyId')

const SUBSCRIPTION_TYPES = ['monthly', '3months', 'yearly']

const getPaymentStats = async () => {
  const baseMatch = { deletedAt: null }
  const { start, end, label } = getISTMonthBounds()

  const [totals, monthly, monthlyByCollector] = await Promise.all([
    PaymentHistory.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalCollection: { $sum: '$amount' },
          totalPayments: { $sum: 1 },
        },
      },
    ]),
    PaymentHistory.aggregate([
      {
        $match: {
          ...baseMatch,
          paymentDate: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          monthlyRevenue: { $sum: '$amount' },
          monthlyPayments: { $sum: 1 },
        },
      },
    ]),
    PaymentHistory.aggregate([
      {
        $match: {
          ...baseMatch,
          paymentDate: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: '$collector',
          revenue: { $sum: '$amount' },
          payments: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
  ])

  return {
    totalCollection: totals[0]?.totalCollection || 0,
    totalPayments: totals[0]?.totalPayments || 0,
    monthlyRevenue: monthly[0]?.monthlyRevenue || 0,
    monthlyPayments: monthly[0]?.monthlyPayments || 0,
    monthLabel: label,
    currency: 'INR',
    monthlyByCollector: monthlyByCollector.map((row) => ({
      collector: row._id || 'Unknown',
      revenue: row.revenue,
      payments: row.payments,
    })),
  }
}

const createPayment = async (req, res, next) => {
  try {
    const { userId, paymentDate, amount, subscriptionType, collector } = req.body

    if (!userId) throw ApiError.badRequest('User is required')
    if (!paymentDate) throw ApiError.badRequest('Payment date is required')
    if (amount === undefined || amount === null) throw ApiError.badRequest('Amount is required')
    if (!subscriptionType || !SUBSCRIPTION_TYPES.includes(subscriptionType)) {
      throw ApiError.badRequest('Valid subscription type is required')
    }
    if (!collector?.trim()) throw ApiError.badRequest('Collector is required')

    const amountNum = Number(amount)
    if (Number.isNaN(amountNum) || amountNum < 1) {
      throw ApiError.badRequest('Amount must be a number of at least 1')
    }

    const user = await User.findOne({ _id: userId, deletedAt: null, role: 'user' })
    if (!user) throw ApiError.notFound('User not found')

    const collectorName = await validateCollectorName(collector)

    const parsedDate = new Date(paymentDate)
    if (Number.isNaN(parsedDate.getTime())) {
      throw ApiError.badRequest('Invalid payment date')
    }

    const payment = await PaymentHistory.create({
      user: user._id,
      paymentDate: parsedDate,
      amount: Math.round(amountNum),
      subscriptionType,
      currency: 'INR',
      collector: collectorName,
      recordedBy: req.user._id,
      recordedByAdmin: getAdminDisplayName(req.user),
    })

    const populated = await PaymentHistory.findById(payment._id)
      .populate('user', 'keyId')
      .lean()

    const stats = await getPaymentStats()

    return ApiResponse.created(res, { payment: populated, stats }, 'Payment recorded successfully')
  } catch (error) {
    next(error)
  }
}

const listPayments = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10))
    const skip = (page - 1) * limit

    const filter = { deletedAt: null }

    if (req.query.subscriptionType && SUBSCRIPTION_TYPES.includes(req.query.subscriptionType)) {
      filter.subscriptionType = req.query.subscriptionType
    }
    if (req.query.collector) {
      filter.collector = req.query.collector
    }

    const [payments, total, stats] = await Promise.all([
      PaymentHistory.find(filter)
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'keyId')
        .lean(),
      PaymentHistory.countDocuments(filter),
      getPaymentStats(),
    ])

    return ApiResponse.success(res, {
      payments,
      stats,
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

const deletePayment = async (req, res, next) => {
  try {
    const payment = await PaymentHistory.findOne({ _id: req.params.id, deletedAt: null })
    if (!payment) throw ApiError.notFound('Payment record not found')

    payment.deletedAt = new Date()
    await payment.save()

    const stats = await getPaymentStats()

    return ApiResponse.success(res, { stats }, 'Payment record deleted')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createPayment,
  listPayments,
  deletePayment,
}
