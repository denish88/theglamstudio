const { User } = require('../models')
const MemberKeyCounter = require('../models/memberKeyCounter.model')
const { ApiError } = require('./apiError')

const MEMBER_KEY_PREFIX = 'tgs-mbr-'
const MAX_MEMBER_SEQUENCE = 26 * 99

function parseMemberKeyId(keyId) {
  if (!keyId) return null
  const match = String(keyId).toLowerCase().match(/^tgs-mbr-([a-z])(\d+)$/)
  if (!match) return null

  const letterIndex = match[1].charCodeAt(0) - 97
  const num = Number.parseInt(match[2], 10)
  if (letterIndex < 0 || letterIndex > 25 || num < 1 || num > 99) return null

  return { letterIndex, num }
}

function sequenceToMemberKeyId(seq) {
  if (seq < 1 || seq > MAX_MEMBER_SEQUENCE) {
    throw ApiError.badRequest('Member ID limit reached (TGS-MBR-Z99)')
  }

  const letterIndex = Math.floor((seq - 1) / 99)
  const num = ((seq - 1) % 99) + 1
  const letter = String.fromCharCode(97 + letterIndex)
  return `${MEMBER_KEY_PREFIX}${letter}${num}`
}

function memberKeyIdToSequence(keyId) {
  const parsed = parseMemberKeyId(keyId)
  if (!parsed) return 0
  return parsed.letterIndex * 99 + parsed.num
}

function formatMemberKeyIdDisplay(keyId) {
  const parsed = parseMemberKeyId(keyId)
  if (!parsed) return keyId

  const letter = String.fromCharCode(65 + parsed.letterIndex)
  return `TGS-MBR-${letter}${parsed.num}`
}

async function syncMemberKeyCounter() {
  const users = await User.find({
    keyId: { $regex: /^tgs-mbr-[a-z]\d+$/i },
    deletedAt: null,
  })
    .select('keyId')
    .lean()

  let maxSeq = 0
  users.forEach((user) => {
    maxSeq = Math.max(maxSeq, memberKeyIdToSequence(user.keyId))
  })

  const counter = await MemberKeyCounter.findById('memberKey').lean()
  if (!counter || counter.seq < maxSeq) {
    await MemberKeyCounter.findByIdAndUpdate(
      'memberKey',
      { $set: { seq: maxSeq } },
      { upsert: true },
    )
  }
}

async function generateNextMemberKeyId() {
  await syncMemberKeyCounter()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const counter = await MemberKeyCounter.findByIdAndUpdate(
      'memberKey',
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    )

    const keyId = sequenceToMemberKeyId(counter.seq)
    const exists = await User.exists({ keyId })
    if (!exists) return keyId
  }

  throw ApiError.internal('Failed to generate a unique member ID. Please try again.')
}

function getAdminDisplayName(user) {
  if (!user) return 'Admin'
  const displayName = user.displayName?.trim()
  if (displayName) return displayName
  return formatMemberKeyIdDisplay(user.keyId) || String(user.keyId || 'Admin').toUpperCase()
}

async function validateCollectorName(collector) {
  const name = collector?.trim()
  if (!name) {
    throw ApiError.badRequest('Collector is required')
  }

  const admins = await User.find({ role: 'admin', deletedAt: null, isActive: true })
    .select('keyId displayName')
    .lean()

  const validNames = admins.map((admin) => getAdminDisplayName(admin))
  if (!validNames.includes(name)) {
    throw ApiError.badRequest('Invalid collector selected')
  }

  return name
}

module.exports = {
  generateNextMemberKeyId,
  formatMemberKeyIdDisplay,
  getAdminDisplayName,
  memberKeyIdToSequence,
  validateCollectorName,
}
