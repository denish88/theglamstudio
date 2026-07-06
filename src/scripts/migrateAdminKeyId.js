const connectDB = require('../config/db')
const { User } = require('../models')
const { normalizeKeyId } = require('../utils/keyId')

const NEW_ADMIN_KEY_ID = 'TGS-AD-01'
const LEGACY_ADMIN_KEY_IDS = ['admin', 'admin_4848', 'tgs-ad-01', 'TGS-AD-01']

const migrate = async () => {
  try {
    await connectDB()

    const existing = await User.findOne({ keyId: NEW_ADMIN_KEY_ID, deletedAt: null })
    if (existing) {
      console.log(`Admin keyId already set: ${NEW_ADMIN_KEY_ID}`)
      console.log(`Role: ${existing.role}, active: ${existing.isActive}`)
      process.exit(0)
      return
    }

    let admin = null
    for (const legacyKeyId of LEGACY_ADMIN_KEY_IDS) {
      admin = await User.findOne({ keyId: legacyKeyId, role: 'admin', deletedAt: null })
      if (admin) break
      admin = await User.findOne({ keyId: normalizeKeyId(legacyKeyId), role: 'admin', deletedAt: null })
      if (admin) break
    }

    if (!admin) {
      admin = await User.findOne({ role: 'admin', deletedAt: null }).sort({ createdAt: 1 })
    }

    if (!admin) {
      console.error('No admin user found to migrate')
      process.exit(1)
      return
    }

    const previousKeyId = admin.keyId
    admin.keyId = NEW_ADMIN_KEY_ID
    if (!admin.displayName || admin.displayName === 'Admin') {
      admin.displayName = null
    }
    await admin.save({ validateBeforeSave: false })

    console.log(`Admin keyId updated: ${previousKeyId} -> ${NEW_ADMIN_KEY_ID}`)
    console.log('Login with Key ID: TGS-AD-01 (same password as before)')

    process.exit(0)
  } catch (error) {
    console.error('Migration failed:', error.message)
    process.exit(1)
  }
}

migrate()
