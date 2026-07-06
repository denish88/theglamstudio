const connectDB = require('../config/db')
const { PaymentHistory } = require('../models')

const DEFAULT_COLLECTOR = 'TGS-AD-01'

const backfill = async () => {
  try {
    await connectDB()

    const filter = { deletedAt: null }
    const before = await PaymentHistory.countDocuments(filter)
    const missingCollector = await PaymentHistory.countDocuments({
      ...filter,
      $or: [
        { collector: null },
        { collector: '' },
        { collector: { $exists: false } },
      ],
    })

    const result = await PaymentHistory.updateMany(filter, {
      $set: { collector: DEFAULT_COLLECTOR },
    })

    console.log(`Payment history records (active): ${before}`)
    console.log(`Previously missing collector: ${missingCollector}`)
    console.log(`Updated: ${result.modifiedCount}`)
    console.log(`Collector set to: ${DEFAULT_COLLECTOR}`)

    process.exit(0)
  } catch (error) {
    console.error('Backfill failed:', error.message)
    process.exit(1)
  }
}

backfill()
