/**
 * Photo download allotment for the full subscription period (not daily).
 * Members may use these anytime until subscription ends.
 */
const DOWNLOAD_LIMITS_BY_PLAN = Object.freeze({
  monthly: 60,
  '3months': 120,
  yearly: 240,
})

function getDownloadLimitForPlan(subscriptionType) {
  return DOWNLOAD_LIMITS_BY_PLAN[subscriptionType] || DOWNLOAD_LIMITS_BY_PLAN.monthly
}

function buildDownloadQuota(subscriptionType, used = 0) {
  const limit = getDownloadLimitForPlan(subscriptionType)
  const safeUsed = Math.max(0, Number(used) || 0)
  return {
    used: Math.min(safeUsed, limit),
    limit,
  }
}

module.exports = {
  DOWNLOAD_LIMITS_BY_PLAN,
  getDownloadLimitForPlan,
  buildDownloadQuota,
}
