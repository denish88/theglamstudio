const { User } = require('../models')
const MemberKeyCounter = require('../models/memberKeyCounter.model')
const { ApiError } = require('./apiError')
const {
  normalizeKeyId,
  parseMemberKeyId,
  formatMemberKeyIdDisplay,
  formatAdminKeyIdDisplay,
  formatKeyIdDisplay,
} = require('./keyId')

const MAX_MEMBER_SEQUENCE = 26 * 99

function sequenceToMemberKeyId(seq) {
  if (seq < 1 || seq > MAX_MEMBER_SEQUENCE) {
    throw ApiError.badRequest('Member ID limit reached (TGS-MBR-Z99)')
  }

  const letterIndex = Math.floor((seq - 1) / 99)
  const num = ((seq - 1) % 99) + 1
  const letter = String.fromCharCode(65 + letterIndex)
  return `TGS-MBR-${letter}${num}`
}

function memberKeyIdToSequence(keyId) {
  const parsed = parseMemberKeyId(keyId)
  if (!parsed) return 0
  return parsed.letterIndex * 99 + parsed.num
}

async function syncMemberKeyCounter() {
  const users = await User.find({
    keyId: { $regex: /^TGS-MBR-[A-Z]\d+$/i },
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
  return formatAdminKeyIdDisplay(user.keyId)
    || formatMemberKeyIdDisplay(user.keyId)
    || user.keyId
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
  normalizeKeyId,
  formatMemberKeyIdDisplay,
  formatAdminKeyIdDisplay,
  formatKeyIdDisplay,
  getAdminDisplayName,
  memberKeyIdToSequence,
  validateCollectorName,
}
