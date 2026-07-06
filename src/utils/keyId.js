function isTgsKeyId(keyId) {
  return /^tgs-(mbr|ad)-/i.test(String(keyId || '').trim())
}

/** Uppercase only TGS-MBR-* and TGS-AD-* IDs. Legacy IDs stay as entered. */
function normalizeKeyId(keyId) {
  if (!keyId) return ''
  const trimmed = String(keyId).trim()

  const memberMatch = trimmed.match(/^tgs-mbr-([a-zA-Z])(\d+)$/i)
  if (memberMatch) {
    return `TGS-MBR-${memberMatch[1].toUpperCase()}${memberMatch[2]}`
  }

  const adminMatch = trimmed.match(/^tgs-ad-(.+)$/i)
  if (adminMatch) {
    return `TGS-AD-${adminMatch[1].toUpperCase()}`
  }

  return trimmed
}

function parseMemberKeyId(keyId) {
  if (!keyId) return null
  const match = String(keyId).match(/^TGS-MBR-([A-Z])(\d+)$/i)
  if (!match) return null

  const letterIndex = match[1].toUpperCase().charCodeAt(0) - 65
  const num = Number.parseInt(match[2], 10)
  if (letterIndex < 0 || letterIndex > 25 || num < 1 || num > 99) return null

  return { letterIndex, num }
}

function formatMemberKeyIdDisplay(keyId) {
  const parsed = parseMemberKeyId(keyId)
  if (!parsed) return keyId

  const letter = String.fromCharCode(65 + parsed.letterIndex)
  return `TGS-MBR-${letter}${parsed.num}`
}

function formatAdminKeyIdDisplay(keyId) {
  if (!keyId) return null
  const match = String(keyId).match(/^TGS-AD-(.+)$/i)
  if (!match) return null
  return `TGS-AD-${match[1].toUpperCase()}`
}

function formatKeyIdDisplay(keyId) {
  return formatMemberKeyIdDisplay(keyId)
    || formatAdminKeyIdDisplay(keyId)
    || keyId
}

module.exports = {
  isTgsKeyId,
  normalizeKeyId,
  parseMemberKeyId,
  formatMemberKeyIdDisplay,
  formatAdminKeyIdDisplay,
  formatKeyIdDisplay,
}
