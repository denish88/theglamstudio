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

const start = async (req, res) => {
  try {
    if (!isConnected) {
      await connectDB()
      isConnected = true
    }

    return app(req, res)
  } catch (err) {
    console.error(err)

    return res.status(500).json({
      success: false,
      message: err.message
    })
  }
}

module.exports = serverless(start)