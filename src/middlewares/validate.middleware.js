const { ApiError } = require('../utils')

const validate = (schema) => (req, res, next) => {
  const errors = []

  for (const [field, rules] of Object.entries(schema)) {
    const value = req.body[field]

    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`)
      continue
    }

    if (value !== undefined && rules.minLength && value.length < rules.minLength) {
      errors.push(`${field} must be at least ${rules.minLength} characters`)
    }

    if (value !== undefined && rules.type && typeof value !== rules.type) {
      errors.push(`${field} must be a ${rules.type}`)
    }
  }

  if (errors.length > 0) {
    return next(ApiError.badRequest('Validation failed', errors))
  }

  next()
}

module.exports = validate
