const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const path = require('path')
const fs = require('fs')

const { NODE_ENV } = require('./config/env')
const corsOptions = require('./config/cors')
const routes = require('./routes')
const { errorHandler, cryptoMiddleware } = require('./middlewares')

const app = express()

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors(corsOptions))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

if (NODE_ENV === 'development') {
  app.use(morgan('dev'))
} else {
  app.use(morgan('combined'))
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { statusCode: 429, status: 0, message: 'Too many requests, please try again later', data: [], metadata: [] },
})
app.use('/api/', limiter)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', environment: NODE_ENV })
})

app.use('/api', cryptoMiddleware, routes)

const CLIENT_BUILD = path.resolve(__dirname, '../public')

if (fs.existsSync(CLIENT_BUILD)) {
  app.use(express.static(CLIENT_BUILD, { maxAge: '1y', immutable: true }))

  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(CLIENT_BUILD, 'index.html'))
  })
} else {
  app.use((req, res) => {
    res.status(404).json({ statusCode: 404, status: 0, message: 'Route not found', data: [], metadata: [] })
  })
}

app.use(errorHandler)

module.exports = app
