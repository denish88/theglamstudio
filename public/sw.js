const CACHE_NAME = 'glam-media-v2'
const MEDIA_PATH = '/api/v1/media/'
const MAX_AGE = 15 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('glam-media-') && k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (!url.pathname.startsWith(MEDIA_PATH)) return
  if (event.request.mode === 'navigate') return

  event.respondWith(serveMedia(event.request))
})

async function serveMedia(request) {
  const cache = await caches.open(CACHE_NAME)
  const cacheKey = stripRetryParam(request.url)
  const cached = await cache.match(cacheKey)

  if (cached) {
    const ts = cached.headers.get('x-sw-ts')
    if (ts && Date.now() - parseInt(ts, 10) < MAX_AGE) {
      return cached
    }
    await cache.delete(cacheKey)
  }

  try {
    const response = await fetch(request, { credentials: 'same-origin' })

    if (!response.ok) {
      return response
    }

    const blob = await response.clone().blob()
    const headers = new Headers(response.headers)
    headers.set('x-sw-ts', Date.now().toString())

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
