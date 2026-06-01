// const app = require('./app')
// const connectDB = require('./config/db')
// const { PORT, NODE_ENV } = require('./config/env')

// const start = async () => {
//   await connectDB()

//   app.listen(PORT, () => {
//     console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`)
//     console.log(`API base: http://localhost:${PORT}/api/v1`)
//   })
// }

// start().catch((err) => {
//   console.error('Failed to start server:', err)
//   process.exit(1)
// })


const serverless = require('serverless-http')

const app = require('./app')
const connectDB = require('./config/db')

let isConnected = false

const connectDatabase = async () => {
  if (!isConnected) {
    await connectDB()
    isConnected = true
    console.log('MongoDB connected')
  }
}

module.exports.handler = async (req, res) => {
  await connectDatabase()

  const handler = serverless(app)

  return handler(req, res)
}