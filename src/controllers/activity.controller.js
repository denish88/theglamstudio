const { User } = require('../models')
const { ApiResponse } = require('../utils')

const DAY_MS = 24 * 60 * 60 * 1000

function computeSubscriptionStatus(sub) {
  const s = sub || {}
  const isActive = s.endDate && new Date(s.endDate) > new Date()
  const planLabels = { monthly: 'Monthly', '3months': '3 Months', yearly: 'Yearly' }
  return {
    type: s.type || null,
    plan: planLabels[s.type] || 'Free',
    status: isActive ? 'active' : 'expired',
    endDate: s.endDate || null,
  }
}

function buildBreakdown(activity, field) {
  const map = new Map()
  for (const entry of activity) {
    const value = entry?.[field]
    if (!value) continue
    const existing = map.get(value)
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0
    if (existing) {
      existing.count += 1
      if (ts > existing.lastSeenTs) existing.lastSeenTs = ts
    } else {
      map.set(value, { value, count: 1, lastSeenTs: ts })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || b.lastSeenTs - a.lastSeenTs)
    .map((item) => ({
      value: item.value,
      count: item.count,
      lastSeen: item.lastSeenTs ? new Date(item.lastSeenTs) : null,
    }))
}

// Groups logins into real devices. Prefers the stable device fingerprint
// (FingerprintJS visitorId); falls back to the User-Agent for older entries
// that don't have a fingerprint yet.
function buildDeviceBreakdown(activity) {
  const map = new Map()
  for (const entry of activity) {
    const key = entry?.deviceId || entry?.browserFingerprint
    if (!key) continue
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
      if (ts >= existing.lastSeenTs) {
        existing.lastSeenTs = ts
        existing.ua = entry.browserFingerprint || existing.ua
      }
    } else {
      map.set(key, {
        deviceId: entry.deviceId || null,
        ua: entry.browserFingerprint || null,
        count: 1,
        lastSeenTs: ts,
      })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || b.lastSeenTs - a.lastSeenTs)
    .map((item) => ({
      deviceId: item.deviceId,
      ua: item.ua,
      count: item.count,
      lastSeen: item.lastSeenTs ? new Date(item.lastSeenTs) : null,
    }))
}

function analyzeUser(user) {
  const activity = Array.isArray(user.loginActivity) ? user.loginActivity : []
  if (activity.length === 0) return null

  const now = Date.now()
  const timestamps = activity
    .map((a) => (a.timestamp ? new Date(a.timestamp).getTime() : null))
    .filter(Boolean)

  const ipBreakdown = buildBreakdown(activity, 'ipAddress')
  const deviceBreakdown = buildDeviceBreakdown(activity)

  const distinctIps = ipBreakdown.length
  const distinctDevices = deviceBreakdown.length
  const loginsLast24h = timestamps.filter((t) => now - t <= DAY_MS).length
  const loginsLast7d = timestamps.filter((t) => now - t <= 7 * DAY_MS).length
  const lastLogin = timestamps.length ? new Date(Math.max(...timestamps)) : null
  const firstTrackedLogin = timestamps.length ? new Date(Math.min(...timestamps)) : null

  // Fraud / credential-sharing heuristics
  const flagged =
    distinctIps >= 3 ||
    distinctDevices >= 3 ||
    loginsLast24h >= 6 ||
    (distinctIps >= 2 && distinctDevices >= 2)

  if (!flagged) return null

  let score = 0
  const reasons = []

  if (distinctIps >= 4) {
    score += 50
    reasons.push(`Logged in from ${distinctIps} different IP addresses`)
  } else if (distinctIps === 3) {
    score += 32
    reasons.push('Logged in from 3 different IP addresses')
  } else if (distinctIps === 2) {
    score += 14
    reasons.push('Logged in from 2 different IP addresses')
  }

  if (distinctDevices >= 4) {
    score += 40
    reasons.push(`Used ${distinctDevices} different devices/browsers`)
  } else if (distinctDevices === 3) {
    score += 24
    reasons.push('Used 3 different devices/browsers')
  } else if (distinctDevices === 2) {
    score += 10
    reasons.push('Used 2 different devices/browsers')
  }

  if (loginsLast24h >= 8) {
    score += 28
    reasons.push(`${loginsLast24h} logins in the last 24 hours`)
  } else if (loginsLast24h >= 6) {
    score += 16
    reasons.push(`${loginsLast24h} logins in the last 24 hours`)
  }

  let riskLevel = 'low'
  if (score >= 55) riskLevel = 'high'
  else if (score >= 28) riskLevel = 'medium'

  const recentActivity = activity
    .slice()
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 30)
    .map((a) => ({
      timestamp: a.timestamp || null,
      ipAddress: a.ipAddress || null,
      browserFingerprint: a.browserFingerprint || null,
      deviceId: a.deviceId || null,
    }))

  return {
    id: user._id,
    keyId: user.keyId,
    collector: user.collector || null,
    isActive: user.isActive,
    createdAt: user.createdAt,
    subscription: computeSubscriptionStatus(user.subscription),
    riskLevel,
    riskScore: score,
    reasons,
    stats: {
      totalTrackedLogins: activity.length,
      distinctIps,
      distinctDevices,
      loginsLast24h,
      loginsLast7d,
      lastLogin,
      firstTrackedLogin,
    },
    ips: ipBreakdown.map((i) => ({ ip: i.value, count: i.count, lastSeen: i.lastSeen })),
    devices: deviceBreakdown.map((d) => ({
      deviceId: d.deviceId,
      ua: d.ua,
      count: d.count,
      lastSeen: d.lastSeen,
    })),
    recentActivity,
  }
}

const getSuspiciousUsers = async (req, res, next) => {
  try {
    const users = await User.find({
      role: 'user',
      deletedAt: null,
      'loginActivity.0': { $exists: true },
    })
      .select('keyId collector isActive createdAt subscription loginActivity')
      .lean()

    const suspicious = []
    for (const user of users) {
      const analyzed = analyzeUser(user)
      if (analyzed) suspicious.push(analyzed)
    }

    suspicious.sort(
      (a, b) =>
        b.riskScore - a.riskScore ||
        new Date(b.stats.lastLogin || 0) - new Date(a.stats.lastLogin || 0),
    )

    const summary = {
      scannedUsers: users.length,
      flagged: suspicious.length,
      high: suspicious.filter((u) => u.riskLevel === 'high').length,
      medium: suspicious.filter((u) => u.riskLevel === 'medium').length,
      low: suspicious.filter((u) => u.riskLevel === 'low').length,
    }

    ApiResponse.success(res, { suspiciousUsers: suspicious, summary })
  } catch (error) {
    next(error)
  }
}

module.exports = { getSuspiciousUsers }
