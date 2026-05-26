const { CORS_ORIGIN } = require('./env')

const corsOptions = {
  origin: CORS_ORIGIN.includes(',')
    ? CORS_ORIGIN.split(',').map((o) => o.trim())
    : CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Encrypted', 'X-Device-Id'],
}

module.exports = corsOptions
