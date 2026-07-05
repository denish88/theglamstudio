const store = new Map()

async function get(key, ttlMs, loader) {
  const now = Date.now()
  const entry = store.get(key)
  if (entry && entry.expiresAt > now) {
    return entry.value
  }

  const value = await loader()
  store.set(key, { value, expiresAt: now + ttlMs })
  return value
}

function invalidate(key) {
  store.delete(key)
}

function invalidateAll() {
  store.clear()
}

module.exports = {
  get,
  invalidate,
  invalidateAll,
}
