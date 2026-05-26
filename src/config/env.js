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
  CRYPTO_SECRET: process.env.CRYPTO_SECRET || 'theglamclub-shared-crypto-key-2026!',
  ENABLE_ENCRYPTION: process.env.ENABLE_ENCRYPTION === 'true',

  R2_ENDPOINT: process.env.R2_ENDPOINT,
  R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
  R2_SECRET_KEY: process.env.R2_SECRET_KEY,
  R2_BUCKET: process.env.R2_BUCKET,
}
