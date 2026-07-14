const app = require('./app')
const connectDB = require('./config/db')
const { PORT, NODE_ENV } = require('./config/env')

const UPLOAD_SERVER_TIMEOUT_MS = 15 * 60 * 1000 // keep in sync with uploadTimeout middleware

const start = async () => {
  await connectDB()

  const server = app.listen(PORT, () => {
    console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`)
    console.log(`API base: http://localhost:${PORT}/api/v1`)
  })

  // Node 18+ defaults requestTimeout to 5 minutes — too short for large uploads
  server.requestTimeout = UPLOAD_SERVER_TIMEOUT_MS
  server.headersTimeout = UPLOAD_SERVER_TIMEOUT_MS + 1000
  server.timeout = UPLOAD_SERVER_TIMEOUT_MS
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
