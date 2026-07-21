/**
 * IP geolocation via MaxMind GeoLite2 City + ASN (local MMDB).
 * Databases are managed by geolite2-redist (`npm run preload`).
 */

const maxmind = require('maxmind')

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** @type {import('maxmind').Reader|null} */
let cityReader = null
/** @type {import('maxmind').Reader|null} */
let asnReader = null
/** @type {Promise<void>|null} */
let initPromise = null

function normalizeIp(raw) {
  if (!raw || typeof raw !== 'string') return null
  let ip = raw.trim()
  if (!ip) return null
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.split(':')[0]
  }
  return ip || null
}

/**
 * Extract the real client IP, preferring Cloudflare when present.
 * Priority: cf-connecting-ip → x-forwarded-for (first) → req.ip → socket.remoteAddress
 */
function getClientIp(req) {
  if (!req) return null

  const headers = req.headers || {}

  const cfConnectingIp = headers['cf-connecting-ip']
  if (cfConnectingIp) {
    const value = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp
    const normalized = normalizeIp(value)
    if (normalized) return normalized
  }

  const forwardedFor = headers['x-forwarded-for']
  if (forwardedFor) {
    const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
    const first = String(raw).split(',')[0]
    const normalized = normalizeIp(first)
    if (normalized) return normalized
  }

  if (req.ip) {
    const normalized = normalizeIp(req.ip)
    if (normalized) return normalized
  }

  return normalizeIp(req.socket?.remoteAddress || null)
}

function isPrivateOrLocalIp(ip) {
  if (!ip) return true
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '127.0.0.1' || lower === 'localhost') return true
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true
  if (ip.includes('%')) return true
  return false
}

function emptyGeo(status, message) {
  return {
    status,
    message,
    city: null,
    region: null,
    country: null,
    countryCode: null,
    zip: null,
    lat: null,
    lon: null,
    isp: null,
    org: null,
    asn: null,
    timezone: null,
  }
}

/**
 * Open GeoLite2 City + ASN once at startup (or lazily) and reuse readers.
 * Never throws — logs errors so the server can keep running.
 */
async function initGeoDatabases() {
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      const geolite2 = await import('geolite2-redist')
      const [city, asn] = await Promise.all([
        geolite2.open('GeoLite2-City', (dbPath) => maxmind.open(dbPath)),
        geolite2.open('GeoLite2-ASN', (dbPath) => maxmind.open(dbPath)),
      ])
      cityReader = city
      asnReader = asn
      console.log('[ipGeo] GeoLite2 City + ASN databases ready')
    } catch (error) {
      console.error('[ipGeo] Failed to initialize GeoLite2 databases:', error)
      cityReader = null
      asnReader = null
    }
  })()

  return initPromise
}

function readCityRecord(ip) {
  if (!cityReader) return null
  try {
    return cityReader.get(ip) || null
  } catch (error) {
    console.error(`[ipGeo] City lookup failed for ${ip}:`, error?.message || error)
    return null
  }
}

function readAsnRecord(ip) {
  if (!asnReader) return null
  try {
    return asnReader.get(ip) || null
  } catch (error) {
    console.error(`[ipGeo] ASN lookup failed for ${ip}:`, error?.message || error)
    return null
  }
}

function buildGeoFromRecords(cityRecord, asnRecord) {
  if (!cityRecord && !asnRecord) {
    return emptyGeo('fail', 'IP not found in GeoLite2 database')
  }

  const city = cityRecord?.city?.names?.en || null
  const region = cityRecord?.subdivisions?.[0]?.names?.en || null
  const country =
    cityRecord?.country?.names?.en || cityRecord?.registered_country?.names?.en || null
  const countryCode =
    cityRecord?.country?.iso_code || cityRecord?.registered_country?.iso_code || null
  const zip = cityRecord?.postal?.code || null
  const lat =
    typeof cityRecord?.location?.latitude === 'number' ? cityRecord.location.latitude : null
  const lon =
    typeof cityRecord?.location?.longitude === 'number' ? cityRecord.location.longitude : null
  const timezone = cityRecord?.location?.time_zone || null

  const asnNumber = asnRecord?.autonomous_system_number ?? null
  const asnOrg = asnRecord?.autonomous_system_organization || null
  const asn = asnNumber != null ? `AS${asnNumber}` : null

  return {
    status: 'success',
    message: null,
    city,
    region,
    country,
    countryCode,
    zip,
    lat,
    lon,
    isp: asnOrg,
    org: asnOrg,
    asn,
    timezone,
  }
}

function isCacheFresh(entry) {
  if (!entry?.lookedUpAt) return false
  const ts = new Date(entry.lookedUpAt).getTime()
  if (Number.isNaN(ts)) return false
  return Date.now() - ts < CACHE_TTL_MS
}

/**
 * Lookup geo for a list of IPs. Uses cached entries from user.ipDetails when fresh.
 * Never throws for lookup failures — returns fallback geo entries instead.
 * @returns {{ geoByIp: Record<string, object>, updatedCache: Record<string, object> }}
 */
async function lookupIpLocations(ips, existingCache = {}) {
  const uniqueIps = [...new Set(ips.map(normalizeIp).filter(Boolean))]
  const geoByIp = {}
  const updatedCache = { ...(existingCache && typeof existingCache === 'object' ? existingCache : {}) }
  const toLookup = []

  for (const ip of uniqueIps) {
    if (isPrivateOrLocalIp(ip)) {
      geoByIp[ip] = emptyGeo('private', 'Private / local IP')
      continue
    }

    const cached = updatedCache[ip]
    if (isCacheFresh(cached)) {
      geoByIp[ip] = {
        ...cached,
        status: cached.status || 'success',
        asn: cached.asn ?? null,
      }
      continue
    }

    toLookup.push(ip)
  }

  if (toLookup.length > 0) {
    await initGeoDatabases()

    if (!cityReader && !asnReader) {
      for (const ip of toLookup) {
        const entry = {
          ...emptyGeo('fail', 'GeoLite2 database unavailable'),
          lookedUpAt: new Date().toISOString(),
        }
        geoByIp[ip] = entry
        updatedCache[ip] = entry
      }
      return { geoByIp, updatedCache }
    }

    for (const ip of toLookup) {
      const cityRecord = readCityRecord(ip)
      const asnRecord = readAsnRecord(ip)
      const geo = buildGeoFromRecords(cityRecord, asnRecord)
      const entry = {
        ...geo,
        lookedUpAt: new Date().toISOString(),
      }
      geoByIp[ip] = entry
      updatedCache[ip] = entry
    }
  }

  return { geoByIp, updatedCache }
}

function formatLocationLabel(geo) {
  if (!geo || geo.status === 'private') return 'Private / local network'
  if (geo.status !== 'success') return geo.message || 'Location unavailable'
  return [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || 'Unknown'
}

module.exports = {
  normalizeIp,
  getClientIp,
  isPrivateOrLocalIp,
  initGeoDatabases,
  lookupIpLocations,
  formatLocationLabel,
}
