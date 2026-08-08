const CACHE_NAME = 'glam-media-v4'
const MEDIA_PATH = '/api/v1/media/'
const MAX_AGE = 15 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500
const VIDEO_EXT_RE = /\.(mp4|webm)(?:\?|$)/i

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('glam-media-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      )

      // Strip any video entries that may have been cached by older SW versions
      const cache = await caches.open(CACHE_NAME)
      const requests = await cache.keys()
      await Promise.all(
        requests
          .filter((req) => VIDEO_EXT_RE.test(new URL(req.url).pathname))
          .map((req) => cache.delete(req)),
      )

      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (!url.pathname.startsWith(MEDIA_PATH)) return
  if (event.request.mode === 'navigate') return

  // Never cache or intercept videos / Range requests.
  // Browser talks to the API directly (auth cookie + anti-hotlink still apply).
  if (VIDEO_EXT_RE.test(url.pathname) || event.request.headers.has('range')) {
    return
  }

  event.respondWith(serveMedia(event.request))
})

self.addEventListener('push', (event) => {
  let payload = {
    title: 'The Glam Club 💎',
    body: '🔥 New exclusive content has been uploaded!',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: { url: '/home' },
  }

  try {
    if (event.data) {
      const parsed = event.data.json()
      payload = { ...payload, ...parsed }
    }
  } catch {
    try {
      const text = event.data?.text()
      if (text) payload.body = text
    } catch {
      // keep defaults
    }
  }

  const origin = self.location.origin
  const icon = absoluteAsset(payload.icon, origin, '/favicon.png')
  const badge = absoluteAsset(payload.badge, origin, '/favicon.png')
  const url = resolveClickUrl(payload?.data?.url, origin)

  event.waitUntil(
    self.registration.showNotification(payload.title || 'The Glam Club 💎', {
      body: payload.body || '',
      icon,
      badge,
      tag: payload.tag || 'theglam-push',
      renotify: payload.renotify !== false,
      data: { ...(payload.data || {}), url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = resolveClickUrl(event.notification?.data?.url, self.location.origin)

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus()
          if ('navigate' in client) {
            return client.navigate(targetUrl)
          }
          return undefined
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
      return undefined
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(handleSubscriptionChange(event))
})

async function handleSubscriptionChange(event) {
  try {
    const applicationServerKey = await fetchVapidPublicKey()
    if (!applicationServerKey) return

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(applicationServerKey),
    })

    const apiBase = await resolveApiBase()
    await fetch(`${apiBase}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
      credentials: 'include',
    })

    if (event.oldSubscription?.endpoint) {
      await fetch(`${apiBase}/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
        credentials: 'include',
      })
    }
  } catch (error) {
    console.error('[sw] pushsubscriptionchange failed', error)
  }
}

async function fetchVapidPublicKey() {
  try {
    const apiBase = await resolveApiBase()
    const res = await fetch(`${apiBase}/push/vapid-public-key`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const json = await res.json()
    return json?.data?.publicKey || json?.publicKey || null
  } catch {
    return null
  }
}

async function resolveApiBase() {
  // Prefer same-origin proxy in production builds served by the API
  return `${self.location.origin}/api/v1`
}

function absoluteAsset(value, origin, fallbackPath) {
  if (!value) return `${origin}${fallbackPath}`
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/')) return `${origin}${value}`
  return `${origin}/${value}`
}

function resolveClickUrl(value, origin) {
  if (!value) return `${origin}/home`
  try {
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value)
      if (parsed.origin === origin) return parsed.href
      return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`
    }
    return new URL(value, origin).href
  } catch {
    return `${origin}/home`
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

async function serveMedia(request) {
  const url = new URL(request.url)

  // Defense in depth: never cache Range responses or video files
  if (VIDEO_EXT_RE.test(url.pathname) || request.headers.has('range')) {
    return fetch(request, { credentials: 'same-origin' })
  }

  const cache = await caches.open(CACHE_NAME)
  const cacheKey = stripRetryParam(request.url)
  const cached = await cache.match(cacheKey)

  if (cached) {
    const ts = cached.headers.get('x-sw-ts')
    if (ts && Date.now() - Number.parseInt(ts, 10) < MAX_AGE) {
      return cached
    }
    await cache.delete(cacheKey)
  }

  try {
    const response = await fetch(request, { credentials: 'same-origin' })

    if (!response.ok || response.status === 206) {
      return response
    }

    const blob = await response.clone().blob()
    const headers = new Headers(response.headers)
    headers.set('x-sw-ts', String(Date.now()))

    const toCache = new Response(blob, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })

    await cache.put(cacheKey, toCache)
    trimCache(cache)

    return response
  } catch {
    return fetch(request, { credentials: 'same-origin' })
  }
}

function stripRetryParam(url) {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('_r')
    return parsed.toString()
  } catch {
    return url
  }
}

async function trimCache(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) return
  const excess = keys.slice(0, keys.length - MAX_ENTRIES)
  await Promise.all(excess.map((k) => cache.delete(k)))
}
