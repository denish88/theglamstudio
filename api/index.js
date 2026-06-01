const serverless = require('serverless-http')

const app = require('../src/app')
const connectDB = require('../src/config/db')

let isConnected = false

async function connectDatabase() {
  if (!isConnected) {
    await connectDB()
    isConnected = true
    console.log('MongoDB Connected')
  }
}

const handler = serverless(app)

module.exports = async (req, res) => {
  try {
    await connectDatabase()
    return handler(req, res)
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    })
  }
}