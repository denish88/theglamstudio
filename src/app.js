const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const cookieParser = require('cookie-parser')
const path = require('path')
const fs = require('fs')

const { NODE_ENV } = require('./config/env')
const corsOptions = require('./config/cors')
const routes = require('./routes')
const { errorHandler, cryptoMiddleware } = require('./middlewares')

const app = express()

app.set('trust proxy', 1)

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'"
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https:"
        ],

        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://images.unsplash.com",
          "https://plus.unsplash.com",
          "https://*.r2.cloudflarestorage.com"
        ],

        connectSrc: [
          "'self'",
          "https://images.unsplash.com",
          "https://plus.unsplash.com"
        ],

        fontSrc: [
          "'self'",
          "https:",
          "data:"
        ]
      }
    }
  })
)
app.use(cors(corsOptions))
app.use(cookieParser())
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true }))

if (NODE_ENV === 'development') {
  app.use(morgan('dev'))
} else {
  app.use(morgan('combined'))
}

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
