const path = require('path')
const dotenv = require('dotenv')

const NODE_ENV = process.env.NODE_ENV || 'development'
const envFile = NODE_ENV === 'production' ? '.env.prod' : '.env.dev'

dotenv.config({ path: path.resolve(__dirname, '../../env', envFile) })

module.exports = {
  NODE_ENV,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/theglamclub_dev',
  JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  FRONTEND_URL: process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173',
  CRYPTO_SECRET: process.env.CRYPTO_SECRET || 'theglamclub-shared-crypto-key-2026!',
  ENABLE_ENCRYPTION: process.env.ENABLE_ENCRYPTION === 'true',

  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:admin@theglam.club',

  R2_ENDPOINT: process.env.R2_ENDPOINT,
  R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
  R2_SECRET_KEY: process.env.R2_SECRET_KEY,
  R2_BUCKET: process.env.R2_BUCKET,
  /** Optional custom domain for R2 public/signed playback (e.g. https://media.yourdomain.com) */
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || '',
}
