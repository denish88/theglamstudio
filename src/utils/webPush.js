const webpush = require('web-push')
const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  FRONTEND_URL,
} = require('../config/env')
const { PushSubscription } = require('../models')
const { processInBatches } = require('./processInBatches')

const SEND_BATCH_SIZE = 100
let configured = false

function isPushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
}

function ensureConfigured() {
  if (configured) return isPushConfigured()
  configured = true

  if (!isPushConfigured()) {
    console.warn('[webPush] VAPID keys missing — push notifications disabled')
    return false
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@theglam.club',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  )
  return true
}

function toWebPushSubscription(doc) {
  return {
    endpoint: doc.endpoint,
    expirationTime: doc.expirationTime ?? null,
    keys: {
      p256dh: doc.keys.p256dh,
      auth: doc.keys.auth,
    },
  }
}

function isGoneError(error) {
  const status = error?.statusCode || error?.status
  return status === 404 || status === 410
}

async function removeSubscriptionByEndpoint(endpoint) {
  if (!endpoint) return
  await PushSubscription.deleteOne({ endpoint })
}

/**
 * Send one notification. Removes the subscription on 404/410.
 * @returns {{ ok: boolean, removed?: boolean, error?: string }}
 */
async function sendToSubscription(doc, payload) {
  if (!ensureConfigured()) {
    return { ok: false, error: 'Push not configured' }
  }

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)

  try {
    await webpush.sendNotification(toWebPushSubscription(doc), body, {
      TTL: 60 * 60 * 12,
      urgency: 'normal',
    })
    return { ok: true }
  } catch (error) {
    if (isGoneError(error)) {
      await removeSubscriptionByEndpoint(doc.endpoint)
      return { ok: false, removed: true, error: 'Subscription expired' }
    }
    console.error('[webPush] send failed:', error?.statusCode || error?.message || error)
    return { ok: false, error: error?.message || 'Send failed' }
  }
}

/**
 * Broadcast to all stored subscriptions in batches (non-blocking helper).
 */
async function broadcastPush(payload) {
  if (!ensureConfigured()) {
    return { sent: 0, failed: 0, removed: 0, skipped: true }
  }

  const cursor = PushSubscription.find({}).select('endpoint keys expirationTime').lean().cursor()
  let batch = []
  let sent = 0
  let failed = 0
  let removed = 0

  const flush = async () => {
    if (batch.length === 0) return
    const results = await processInBatches(batch, SEND_BATCH_SIZE, (doc) =>
      sendToSubscription(doc, payload),
    )
    for (const result of results) {
      if (result.ok) sent += 1
      else {
        failed += 1
        if (result.removed) removed += 1
      }
    }
    batch = []
  }

  for await (const doc of cursor) {
    batch.push(doc)
    if (batch.length >= SEND_BATCH_SIZE) {
      await flush()
    }
  }
  await flush()

  return { sent, failed, removed, skipped: false }
}

function buildNewPostPayload(post) {
  const base = String(FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
  const postId = post?._id ? String(post._id) : ''
  const url = `${base}/home`

  return {
    title: 'The Glam Club 💎',
    body: '🔥 New exclusive content has been uploaded!',
    icon: `${base}/logo.png`,
    badge: `${base}/favicon.png`,
    tag: postId ? `post-${postId}` : 'new-post',
    renotify: true,
    data: {
      url,
      postId: postId || null,
    },
  }
}

/**
 * Fire-and-forget broadcast when a post is published.
 */
function notifyNewPostPublished(post) {
  if (!ensureConfigured()) return

  const payload = buildNewPostPayload(post)
  setImmediate(() => {
    broadcastPush(payload)
      .then((stats) => {
        console.log(
          `[webPush] new post notify — sent=${stats.sent} failed=${stats.failed} removed=${stats.removed}`,
        )
      })
      .catch((error) => {
        console.error('[webPush] broadcast error:', error?.message || error)
      })
  })
}

module.exports = {
  isPushConfigured,
  ensureConfigured,
  sendToSubscription,
  broadcastPush,
  buildNewPostPayload,
  notifyNewPostPublished,
  removeSubscriptionByEndpoint,
}
