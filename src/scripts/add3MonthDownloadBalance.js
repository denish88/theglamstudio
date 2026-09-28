/**
 * Add 60 photo downloads to existing 3-month members who already have downloads on.
 * Downloads already used are kept. Safe to run again: anyone already at 180 or above is skipped.
 *
 * Usage (from theglamserver):
 *   node src/scripts/add3MonthDownloadBalance.js
 */
const connectDB = require('../config/db')
const { User } = require('../models')
const { getDownloadLimitForPlan } = require('../utils/downloadLimits')

const BONUS = 60
const NEW_LIMIT = getDownloadLimitForPlan('3months')

function readUsed(quota) {
  const rawUsed = quota?.used
  if (Number.isFinite(Number(rawUsed))) return Math.max(0, Number(rawUsed))
  return Math.max(0, Number(quota?.count) || 0)
}

const addBalance = async () => {
  try {
    await connectDB()

    if (NEW_LIMIT !== 180) {
      throw new Error(`Expected 3-month limit to be 180, got ${NEW_LIMIT}`)
    }

    const users = await User.find({
      downloadEnabled: true,
      'subscription.type': '3months',
      role: { $ne: 'admin' },
    }).select('keyId subscription downloadQuota downloadEnabled deletedAt')

    console.log(`Found ${users.length} download-enabled 3-month user(s)`)
    console.log(`Adding ${BONUS} to the limit (new plan limit ${NEW_LIMIT}). Used count stays the same.\n`)

    let updated = 0
    let skipped = 0

    for (const user of users) {
      const currentLimit = Number(user.downloadQuota?.limit)
      const used = readUsed(user.downloadQuota)
      const deleted = user.deletedAt ? ' deleted' : ''

      if (Number.isFinite(currentLimit) && currentLimit >= NEW_LIMIT) {
        skipped += 1
        console.log(`  skip ${user.keyId}: limit already ${currentLimit} (used ${used})${deleted}`)
        continue
      }

      const nextLimit = Number.isFinite(currentLimit) && currentLimit > 0
        ? currentLimit + BONUS
        : NEW_LIMIT

      user.downloadQuota = { used, limit: nextLimit }
      await user.save({ validateBeforeSave: false })
      updated += 1

      const beforeRemaining = Number.isFinite(currentLimit) && currentLimit > 0
        ? Math.max(0, currentLimit - used)
        : 0
      const afterRemaining = Math.max(0, nextLimit - used)

      console.log(
        `  ${user.keyId}: limit ${Number.isFinite(currentLimit) ? currentLimit : 'none'} → ${nextLimit}, `
        + `used ${used}, remaining ${beforeRemaining} → ${afterRemaining}${deleted}`,
      )
    }

    console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`)
    process.exit(0)
  } catch (error) {
    console.error('Balance update failed:', error.message)
    process.exit(1)
  }
}

addBalance()
