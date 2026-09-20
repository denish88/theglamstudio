const mongoose = require('mongoose')

const SESSION_KEY = 'request-session'

/**
 * Singleton settings for the weekly Request Session.
 * Each time admin turns ON, a new windowId starts — members may submit once per window.
 * Typical schedule: open Sunday → close end of Sunday (EOD).
 */
const requestSessionSettingsSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: SESSION_KEY,
      unique: true,
      sparse: true,
    },
    isEnabled: {
      type: Boolean,
      default: false,
    },
    /** Increments every time the session is opened */
    currentWindowId: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentWindowOpenedAt: {
      type: Date,
      default: null,
    },
    currentWindowClosedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

requestSessionSettingsSchema.index({ singletonKey: 1 })

const RequestSessionSettings = mongoose.model(
  'RequestSessionSettings',
  requestSessionSettingsSchema,
)

module.exports = RequestSessionSettings
module.exports.SESSION_KEY = SESSION_KEY
