const { PushSubscription } = require('../models')
const { ApiError, ApiResponse } = require('../utils')
const {
  isPushConfigured,
  ensureConfigured,
  broadcastPush,
  buildNewPostPayload,
} = require('../utils/webPush')
const { VAPID_PUBLIC_KEY } = require('../config/env')

function validateSubscriptionBody(body = {}) {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth

  if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
    throw ApiError.badRequest('Valid subscription endpoint is required')
  }
  if (!p256dh || typeof p256dh !== 'string') {
    throw ApiError.badRequest('Subscription keys.p256dh is required')
  }
  if (!auth || typeof auth !== 'string') {
    throw ApiError.badRequest('Subscription keys.auth is required')
  }

  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime:
      typeof body.expirationTime === 'number' ? body.expirationTime : null,
  }
}

const getVapidPublicKey = async (req, res, next) => {
  try {
    if (!isPushConfigured()) {
      throw ApiError.internal('Push notifications are not configured')
    }
    ApiResponse.success(res, { publicKey: VAPID_PUBLIC_KEY })
  } catch (error) {
    next(error)
  }
}

const subscribe = async (req, res, next) => {
  try {
    ensureConfigured()
    if (!isPushConfigured()) {
      throw ApiError.internal('Push notifications are not configured')
    }

    const subscription = validateSubscriptionBody(req.body)
    const userAgent = req.headers['user-agent']
      ? String(req.headers['user-agent']).slice(0, 512)
      : null
    const userId = req.user?._id || null

    const doc = await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          keys: subscription.keys,
          expirationTime: subscription.expirationTime,
          userAgent,
          ...(userId ? { userId } : {}),
        },
        $setOnInsert: {
          endpoint: subscription.endpoint,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    ApiResponse.success(
      res,
      { id: doc._id, endpoint: doc.endpoint },
      'Subscribed to push notifications',
    )
  } catch (error) {
    next(error)
  }
}

const unsubscribe = async (req, res, next) => {
  try {
    const endpoint =
      (typeof req.body?.endpoint === 'string' && req.body.endpoint.trim()) ||
      (typeof req.query?.endpoint === 'string' && req.query.endpoint.trim()) ||
      ''

    if (!endpoint) {
      throw ApiError.badRequest('Subscription endpoint is required')
    }

    await PushSubscription.deleteOne({ endpoint })
    ApiResponse.success(res, null, 'Unsubscribed from push notifications')
  } catch (error) {
    next(error)
  }
}

/**
 * Admin test / manual broadcast.
 */
const broadcast = async (req, res, next) => {
  try {
    if (!isPushConfigured()) {
      throw ApiError.internal('Push notifications are not configured')
    }

    const title =
      (typeof req.body?.title === 'string' && req.body.title.trim()) ||
      'The Glam Club 💎'
    const body =
      (typeof req.body?.body === 'string' && req.body.body.trim()) ||
      '🔥 New exclusive content has been uploaded!'
    const url =
      (typeof req.body?.url === 'string' && req.body.url.trim()) ||
      buildNewPostPayload(null).data.url

    // Respond immediately; send in background
    ApiResponse.success(res, { queued: true }, 'Broadcast queued')

    setImmediate(() => {
      broadcastPush({
        title,
        body,
        icon: buildNewPostPayload(null).icon,
        badge: buildNewPostPayload(null).badge,
        tag: 'admin-broadcast',
        data: { url },
      }).catch((error) => {
        console.error('[webPush] admin broadcast error:', error?.message || error)
      })
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  broadcast,
}
