const express = require('express')
const { authenticateApiKey } = require('../../middlewares')
const { userController } = require('../../controllers')

const router = express.Router()

/**
 * Open (API-key) routes — no JWT / admin session required.
 * Auth: X-API-Key header (or Authorization: ApiKey <key>)
 */
router.post('/users', authenticateApiKey, userController.createUserViaApiKey)

module.exports = router
