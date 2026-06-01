const express = require('express')

const app = express()

app.get('/', (req, res) => {
  return res.json({
    success: true,
    message: 'Root works'
  })
})

app.get('/health', (req, res) => {
  return res.json({
    success: true,
    health: 'ok'
  })
})

module.exports = app