/**
 * Reset subscription photo-download allotments for all download-enabled users.
 *
 * Limits:
 *   monthly  → 60
 *   3months  → 120
 *   yearly   → 240
 *
 * Usage:
 *   node src/scripts/resetDownloadQuotas.js
 */
const connectDB = require('../config/db')
const { User } = require('../models')
const { buildDownloadQuota, getDownloadLimitForPlan } = require('../utils/downloadLimits')

const reset = async () => {
  try {
    await connectDB()

    const users = await User.find({
      deletedAt: null,
      downloadEnabled: true,
      role: { $ne: 'admin' },
    }).select('keyId subscription downloadQuota downloadEnabled')

    console.log(`Found ${users.length} download-enabled user(s)`)

    let updated = 0
    for (const user of users) {
      const plan = user.subscription?.type || 'monthly'
      const next = buildDownloadQuota(plan, 0)
      const prevUsed = user.downloadQuota?.used ?? user.downloadQuota?.count ?? 0
      const prevLimit = user.downloadQuota?.limit ?? null

      user.downloadQuota = next
      await user.save({ validateBeforeSave: false })
      updated += 1

      console.log(
        `  ${user.keyId}: plan=${plan} limit=${next.limit} `
        + `(was used=${prevUsed}, limit=${prevLimit}) → used=0`,
      )
    }

    console.log(`\nReset complete. Updated ${updated} user(s).`)
    console.log('Limits by plan:', {
      monthly: getDownloadLimitForPlan('monthly'),
      '3months': getDownloadLimitForPlan('3months'),
      yearly: getDownloadLimitForPlan('yearly'),
    })
    process.exit(0)
  } catch (error) {
    console.error('Reset failed:', error.message)
    process.exit(1)
  }
}

reset()
