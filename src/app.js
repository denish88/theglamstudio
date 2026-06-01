const express = require('express')

const app = express()

app.get('/', (req, res) => {
  return res.json({
    success: true,
    route: '/'
  })
})

app.get('/health', (req, res) => {
  return res.json({
    success: true,
    route: '/health'
  })
})

module.exports = app