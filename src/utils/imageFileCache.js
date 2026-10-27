const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { GetObjectCommand } = require('@aws-sdk/client-s3')
const r2Client = require('../config/r2')
const { R2_BUCKET } = require('../config/env')
const ApiError = require('./apiError')

/**
 * Photos must stay on the authenticated /api/v1/media proxy (no signed image URL).
 *
 * Piping R2 → the browser holds one HTTPS socket for the whole slow download.
 * A busy feed fills the pool, every later image queues forever, and the site
 * stays blank until the process restarts.
 *
 * This cache downloads each object to disk as fast as R2 can send it (socket
 * released immediately), then the browser is served from that file. Identical
 * requests share one download. R2 concurrency is capped so the SDK socket
 * queue cannot grow without bound.
 */

function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const CACHE_DIR =
  process.env.MEDIA_CACHE_DIR || path.join(os.tmpdir(), 'theglam-media-cache')
const MAX_CACHE_BYTES = positiveInt(process.env.MEDIA_CACHE_MAX_BYTES, 768 * 1024 * 1024)
const MAX_ITEM_BYTES = 32 * 1024 * 1024
const MAX_R2_CONCURRENCY = 20
const SLOT_WAIT_MS = 10_000
const BODY_TIMEOUT_MS = 15_000
/** Hot photos currently on screen. Scroll repeats are served from here, not R2. */
const MAX_MEMORY_BYTES = 128 * 1024 * 1024
const MAX_MEMORY_ITEM = 3 * 1024 * 1024

/** @type {Map<string, { file: string, meta: string, size: number, etag: string, contentType: string }>} */
const index = new Map()
/** @type {Map<string, number>} */
const pins = new Map()
/** @type {Map<string, Promise<any>>} */
const inflight = new Map()
/** @type {Map<string, { buffer: Buffer, etag: string, contentType: string }>} */
const memory = new Map()

let totalBytes = 0
let memoryBytes = 0
let activeR2 = 0
/** @type {{ resolve: Function, timer: NodeJS.Timeout }[]} */
const waiters = []
let ready = null

function pathsFor(key) {
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  const dir = path.join(CACHE_DIR, hash.slice(0, 2))
  return {
    dir,
    file: path.join(dir, hash),
    meta: path.join(dir, `${hash}.json`),
    tmp: path.join(dir, `${hash}.tmp`),
  }
}

/**
 * ChecksumStream.destroy() does not close its source, so a stalled photo
 * download keeps the R2 socket until the process restarts. Walk the wrapper
 * and destroy the TCP socket itself.
 */
function destroyR2Body(body) {
  if (!body || typeof body !== 'object') return
  const seen = new Set()
  const kill = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    const socket = node.socket
    if (socket && typeof socket.destroy === 'function' && !socket.destroyed) {
      socket.destroy()
    }
    if (typeof node.destroy === 'function' && !node.destroyed) {
      try {
        node.destroy()
      } catch {
        // Stream may already be closed.
      }
    }
    kill(node.source)
    if (node.body && node.body !== node) kill(node.body)
    if (node.req && node.req !== node) kill(node.req)
  }
  try {
    kill(body)
  } catch {
    // Best-effort socket release.
  }
}

function isNotFoundError(err) {
  const name = err?.name || err?.Code || err?.code
  const status = err?.$metadata?.httpStatusCode
  return name === 'NotFound' || name === 'NoSuchKey' || name === '404' || status === 404
}

function pin(key) {
  pins.set(key, (pins.get(key) || 0) + 1)
}

function unpin(key) {
  const next = (pins.get(key) || 0) - 1
  if (next <= 0) pins.delete(key)
  else pins.set(key, next)
}

function remember(key, entry) {
  const prev = index.get(key)
  if (prev) {
    totalBytes -= prev.size
    index.delete(key)
  }
  index.set(key, entry)
  totalBytes += entry.size
}

function touch(key) {
  const entry = index.get(key)
  if (!entry) return
  index.delete(key)
  index.set(key, entry)
}

function rememberMemory(key, entry) {
  if (!entry?.buffer || entry.buffer.length > MAX_MEMORY_ITEM) return
  const prev = memory.get(key)
  if (prev) {
    memoryBytes -= prev.buffer.length
    memory.delete(key)
  }
  while (memoryBytes + entry.buffer.length > MAX_MEMORY_BYTES && memory.size > 0) {
    const oldest = memory.keys().next().value
    const old = memory.get(oldest)
    memory.delete(oldest)
    memoryBytes -= old.buffer.length
  }
  memory.set(key, {
    buffer: entry.buffer,
    etag: entry.etag,
    contentType: entry.contentType,
  })
  memoryBytes += entry.buffer.length
}

function readMemory(key) {
  const hit = memory.get(key)
  if (!hit) return null
  memory.delete(key)
  memory.set(key, hit)
  touch(key)
  return {
    filePath: null,
    buffer: hit.buffer,
    size: hit.buffer.length,
    etag: hit.etag,
    contentType: hit.contentType,
  }
}

async function evictOne() {
  for (const [key, entry] of index) {
    if ((pins.get(key) || 0) > 0) continue
    index.delete(key)
    totalBytes -= entry.size
    await fs.unlink(entry.file).catch(() => {})
    await fs.unlink(entry.meta).catch(() => {})
    return true
  }
  return false
}

async function makeRoom(extra) {
  let guard = index.size + 1
  while (totalBytes + extra > MAX_CACHE_BYTES && guard-- > 0) {
    const evicted = await evictOne()
    if (!evicted) break
  }
}

function acquireSlot() {
  if (activeR2 < MAX_R2_CONCURRENCY) {
    activeR2 += 1
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      timer: setTimeout(() => {
        const at = waiters.indexOf(waiter)
        if (at >= 0) waiters.splice(at, 1)
        const err = new Error('Image storage is busy')
        err.code = 'MEDIA_BUSY'
        reject(err)
      }, SLOT_WAIT_MS),
    }
    waiters.push(waiter)
  })
}

function releaseSlot() {
  activeR2 = Math.max(0, activeR2 - 1)
  const next = waiters.shift()
  if (!next) return
  clearTimeout(next.timer)
  activeR2 += 1
  next.resolve()
}

async function withSlot(fn) {
  await acquireSlot()
  try {
    return await fn()
  } finally {
    releaseSlot()
  }
}

async function readBody(body) {
  if (!body || typeof body.transformToByteArray !== 'function') {
    throw new Error('Empty media object')
  }

  let timer
  let fail
  const timeout = new Promise((_, reject) => {
    fail = reject
  })
  const bump = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      destroyR2Body(body)
      const err = new Error('Timed out reading media from storage')
      err.code = 'R2_TIMEOUT'
      fail(err)
    }, BODY_TIMEOUT_MS)
  }
  if (typeof body.on === 'function') body.on('data', bump)
  bump()

  try {
    const bytes = await Promise.race([body.transformToByteArray(), timeout])
    return Buffer.from(bytes)
  } finally {
    clearTimeout(timer)
    if (typeof body.off === 'function') body.off('data', bump)
  }
}

async function scan(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      await scan(full)
      continue
    }
    if (ent.name.endsWith('.tmp')) {
      await fs.unlink(full).catch(() => {})
      continue
    }
    if (!ent.name.endsWith('.json')) continue

    try {
      const meta = JSON.parse(await fs.readFile(full, 'utf8'))
      const file = full.slice(0, -'.json'.length)
      const st = await fs.stat(file)
      if (!meta?.key || !st.isFile() || st.size <= 0) throw new Error('bad cache entry')
      remember(meta.key, {
        file,
        meta: full,
        size: st.size,
        etag: meta.etag || '',
        contentType: meta.contentType || 'application/octet-stream',
      })
    } catch {
      await fs.unlink(full).catch(() => {})
    }
  }
}

function ensureReady() {
  if (!ready) {
    ready = (async () => {
      await fs.mkdir(CACHE_DIR, { recursive: true })
      await scan(CACHE_DIR)
      await makeRoom(0)
      console.log(
        `[media-cache] ${index.size} files, ${totalBytes} bytes, dir=${CACHE_DIR}`,
      )
    })().catch((err) => {
      ready = null
      throw err
    })
  }
  return ready
}

async function asServable(key, entry) {
  if (entry.size > MAX_MEMORY_ITEM) {
    return {
      filePath: entry.file,
      buffer: null,
      size: entry.size,
      etag: entry.etag,
      contentType: entry.contentType,
    }
  }

  const buffer = await fs.readFile(entry.file)
  const payload = {
    filePath: entry.file,
    buffer,
    size: buffer.length,
    etag: entry.etag,
    contentType: entry.contentType,
  }
  rememberMemory(key, payload)
  return payload
}

async function readHit(key) {
  const hot = readMemory(key)
  if (hot) return hot

  const mem = index.get(key)
  if (mem) {
    try {
      await fs.access(mem.file)
      touch(key)
      return await asServable(key, mem)
    } catch {
      index.delete(key)
      totalBytes -= mem.size
    }
  }

  const paths = pathsFor(key)
  try {
    const meta = JSON.parse(await fs.readFile(paths.meta, 'utf8'))
    const st = await fs.stat(paths.file)
    if (!st.isFile() || st.size <= 0 || meta?.key !== key) throw new Error('bad cache entry')
    const entry = {
      file: paths.file,
      meta: paths.meta,
      size: st.size,
      etag: meta.etag || '',
      contentType: meta.contentType || 'application/octet-stream',
    }
    await makeRoom(entry.size)
    remember(key, entry)
    return await asServable(key, entry)
  } catch {
    return null
  }
}

async function download(key, fallbackContentType) {
  let body
  try {
    const result = await r2Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    )
    body = result.Body
    const declared = Number(result.ContentLength || 0)
    if (declared > MAX_ITEM_BYTES) {
      destroyR2Body(body)
      body = null
      const err = new Error('Media file is too large')
      err.code = 'MEDIA_TOO_BIG'
      throw err
    }

    const buffer = await readBody(body)
    body = null

    if (buffer.length === 0) throw ApiError.notFound('Media not found')
    if (buffer.length > MAX_ITEM_BYTES) {
      const err = new Error('Media file is too large')
      err.code = 'MEDIA_TOO_BIG'
      throw err
    }

    const contentType = result.ContentType || fallbackContentType
    const etag =
      result.ETag || `"${crypto.createHash('sha1').update(buffer).digest('hex')}"`
    const paths = pathsFor(key)

    try {
      await fs.mkdir(paths.dir, { recursive: true })
      await makeRoom(buffer.length)
      await fs.writeFile(paths.tmp, buffer)
      await fs.rename(paths.tmp, paths.file)
      await fs.writeFile(
        paths.meta,
        JSON.stringify({ etag, contentType, size: buffer.length, key }),
      )
      remember(key, {
        file: paths.file,
        meta: paths.meta,
        size: buffer.length,
        etag,
        contentType,
      })
      const payload = { filePath: paths.file, buffer, size: buffer.length, etag, contentType }
      rememberMemory(key, payload)
      return payload
    } catch (writeErr) {
      await fs.unlink(paths.tmp).catch(() => {})
      console.error('[media-cache] write failed, serving from memory:', writeErr.message)
      const payload = { filePath: null, buffer, size: buffer.length, etag, contentType }
      rememberMemory(key, payload)
      return payload
    }
  } catch (err) {
    destroyR2Body(body)
    if (err instanceof ApiError || err.code === 'MEDIA_TOO_BIG' || err.code === 'R2_TIMEOUT') {
      throw err
    }
    if (isNotFoundError(err)) throw ApiError.notFound('Media not found')
    throw err
  }
}

function loadShared(key, fallbackContentType) {
  let job = inflight.get(key)
  if (!job) {
    job = (async () => {
      const hit = await readHit(key)
      if (hit) return hit
      return withSlot(() => download(key, fallbackContentType))
    })().finally(() => {
      if (inflight.get(key) === job) inflight.delete(key)
    })
    inflight.set(key, job)
  }
  return job
}

/**
 * One cache entry per key. Caller must call release() when the response ends
 * so a file that is still being sent is not evicted.
 */
async function getCachedImage(key, fallbackContentType) {
  await ensureReady()
  const shared = await loadShared(key, fallbackContentType)
  const pinFile = Boolean(shared.filePath) && !shared.buffer
  if (pinFile) pin(key)
  return {
    filePath: shared.filePath,
    buffer: shared.buffer || null,
    size: shared.size,
    etag: shared.etag,
    contentType: shared.contentType || fallbackContentType,
    release() {
      if (pinFile) unpin(key)
    },
  }
}

module.exports = {
  getCachedImage,
  destroyR2Body,
  CACHE_DIR,
  MAX_CACHE_BYTES,
}
