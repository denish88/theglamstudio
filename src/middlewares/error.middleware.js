const { NODE_ENV } = require('../config/env')

const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500
  let message = err.message || 'Internal server error'
  const metadata = []

  if (err.name === 'ValidationError') {
    statusCode = 400
    const errors = Object.values(err.errors).map((e) => e.message)
    message = 'Validation failed'
    metadata.push(...errors)
  }

  if (err.code === 11000) {
    statusCode = 409
    const field = Object.keys(err.keyValue)[0]
    message = `${field} already exists`
  }

  if (err.name === 'CastError') {
    statusCode = 400
    message = 'Invalid ID format'
  }

  if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
    metadata.push(...err.errors)
  }

  if (NODE_ENV === 'development' && !err.isOperational && err.stack) {
    metadata.push(err.stack)
  }

  res.status(statusCode).json({
    statusCode,
    status: 0,
    message,
    data: [],
    metadata,
  })
}

module.exports = errorHandler
