const app = require('../src/app')
const connectDB = require('../src/config/db')

let isConnected = false

module.exports = async (req, res) => {
  try {
    if (!isConnected) {
      await connectDB()
      isConnected = true
      console.log('MongoDB Connected')
    }

    return app(req, res)
  } catch (err) {
    console.error(err)

    return res.status(500).json({
      success: false,
      error: err.message
    })
  }
}