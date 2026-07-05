const { PaymentHistory, User } = require('../models')
const { ApiResponse, ApiError } = require('../utils')
const { getISTMonthBounds } = require('../utils/date')

const SUBSCRIPTION_TYPES = ['monthly', '3months', 'yearly']
const LATEST_PAYMENTS_LIMIT = 10

const getPaymentStats = async () => {
  const baseMatch = { deletedAt: null }
  const { start, end, label } = getISTMonthBounds()

  const [totals] = await PaymentHistory.aggregate([
    { $match: baseMatch },
    {
      $group: {
        _id: null,
        totalCollection: { $sum: '$amount' },
        totalPayments: { $sum: 1 },
      },
    },
  ])

  const [monthly] = await PaymentHistory.aggregate([
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
  ])

  return {
    totalCollection: totals?.totalCollection || 0,
    totalPayments: totals?.totalPayments || 0,
    monthlyRevenue: monthly?.monthlyRevenue || 0,
    monthlyPayments: monthly?.monthlyPayments || 0,
    monthLabel: label,
    currency: 'INR',
  }
}

const createPayment = async (req, res, next) => {
  try {
    const { userId, paymentDate, amount, subscriptionType } = req.body

    if (!userId) throw ApiError.badRequest('User is required')
    if (!paymentDate) throw ApiError.badRequest('Payment date is required')
    if (amount === undefined || amount === null) throw ApiError.badRequest('Amount is required')
    if (!subscriptionType || !SUBSCRIPTION_TYPES.includes(subscriptionType)) {
      throw ApiError.badRequest('Valid subscription type is required')
    }

    const amountNum = Number(amount)
    if (Number.isNaN(amountNum) || amountNum < 1) {
      throw ApiError.badRequest('Amount must be a number of at least 1')
    }

    const user = await User.findOne({ _id: userId, deletedAt: null, role: 'user' })
    if (!user) throw ApiError.notFound('User not found')

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
      recordedBy: req.user._id,
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
    const filter = { deletedAt: null }

    if (req.query.subscriptionType && SUBSCRIPTION_TYPES.includes(req.query.subscriptionType)) {
      filter.subscriptionType = req.query.subscriptionType
    }

    const [payments, stats] = await Promise.all([
      PaymentHistory.find(filter)
        .sort({ paymentDate: -1, createdAt: -1 })
        .limit(LATEST_PAYMENTS_LIMIT)
        .populate('user', 'keyId')
        .lean(),
      getPaymentStats(),
    ])

    return ApiResponse.success(res, {
      payments,
      stats,
      limit: LATEST_PAYMENTS_LIMIT,
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
