const connectDB = require('../config/db')
const { User } = require('../models')
const { isTgsKeyId } = require('../utils/keyId')

/** Undo mistaken bulk uppercase migration for legacy user_* IDs. */
const revert = async () => {
  try {
    await connectDB()

    const users = await User.find({ deletedAt: null }).select('keyId').lean()
    let updated = 0

    for (const user of users) {
      if (isTgsKeyId(user.keyId)) continue

      const restored = String(user.keyId).toLowerCase()
      if (restored === user.keyId) continue

      await User.updateOne({ _id: user._id }, { $set: { keyId: restored } })
      console.log(`${user.keyId} -> ${restored}`)
      updated += 1
    }

    console.log(`Done. Restored ${updated} legacy keyId(s). TGS-* IDs unchanged.`)
    process.exit(0)
  } catch (error) {
    console.error('Revert failed:', error.message)
    process.exit(1)
  }
}

revert()
