const RequestSession = require('../models/requestSession.model')
const RequestSessionSettings = require('../models/requestSessionSettings.model')
const { SESSION_KEY } = require('../models/requestSessionSettings.model')
const { ApiResponse, ApiError } = require('../utils')
const { getNextSundayIST, getISTWeekday, getISTDateKey } = require('../utils/date')

const NAME_MAX = 40
const NAME_MIN = 1

const SCHEDULE_COPY = {
  openDay: 'Sunday',
  closeHint: 'End of Sunday (EOD)',
  approvalEta: '5 to 10 days',
  memberGuide:
    'Every Sunday the Request Session opens. You can send two edit names once per open Sunday. Session closes at end of day. Approved edits are usually ready within 5 to 10 days.',
  adminGuide:
    'Open the session on Sunday and close it at EOD. Each open starts a new window — members may submit once per window. Approve requests within about 5–10 days.',
}

async function getOrCreateSettings() {
  let settings = await RequestSessionSettings.findOne({ singletonKey: SESSION_KEY })
  if (!settings) {
    settings = await RequestSessionSettings.create({
      singletonKey: SESSION_KEY,
      isEnabled: false,
      currentWindowId: 0,
    })
  }
  return settings
}

function normalizeName(value, fieldLabel) {
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`${fieldLabel} is required`)
  }
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length < NAME_MIN) {
    throw ApiError.badRequest(`${fieldLabel} is required`)
  }
  if (trimmed.length > NAME_MAX) {
    throw ApiError.badRequest(`${fieldLabel} cannot exceed ${NAME_MAX} characters`)
  }
  return trimmed
}

function serializeRequest(doc) {
  const user = doc.userId && typeof doc.userId === 'object' ? doc.userId : null
  const approver =
    doc.approvedBy && typeof doc.approvedBy === 'object' ? doc.approvedBy : null

  return {
    id: doc._id,
    name1: doc.name1,
    name2: doc.name2,
    status: doc.status,
    sessionWindowId: doc.sessionWindowId ?? null,
    createdAt: doc.createdAt,
    approvedAt: doc.approvedAt,
    user: user
      ? {
          id: user._id,
          keyId: user.keyId,
          role: user.role,
        }
      : null,
    approvedBy: approver
      ? {
          id: approver._id,
          keyId: approver.keyId,
        }
      : null,
  }
}

function buildScheduleMeta(settings, { alreadySubmittedThisWindow = false } = {}) {
  const now = new Date()
  const isSunday = getISTWeekday(now) === 0
  const nextSunday = getNextSundayIST(now, { includeToday: false })
  // If closed and today is Sunday, next open is still "today" messaging for admin; for members use upcoming
  const nextOpen = settings.isEnabled
    ? null
    : getNextSundayIST(now, { includeToday: isSunday })

  const windowId = settings.currentWindowId || 0

  return {
    isEnabled: !!settings.isEnabled,
    windowId,
    openedAt: settings.currentWindowOpenedAt || null,
    closedAt: settings.isEnabled ? null : (settings.currentWindowClosedAt || null),
    alreadySubmittedThisWindow: !!alreadySubmittedThisWindow,
    canSubmit:
      !!settings.isEnabled &&
      windowId > 0 &&
      !alreadySubmittedThisWindow,
    isSundayToday: isSunday,
    nextOpenDate: nextOpen?.dateKey || null,
    nextOpenAt: nextOpen?.start || null,
    todayDateKey: getISTDateKey(now),
    schedule: SCHEDULE_COPY,
  }
}

/**
 * Public feed: session status + schedule + all requests.
 */
const getRequestSessionFeed = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 40))
    const skip = (page - 1) * limit

    const settings = await getOrCreateSettings()
    const windowId = settings.currentWindowId || 0

    let alreadySubmittedThisWindow = false
    if (req.user.role !== 'admin' && windowId > 0) {
      const mine = await RequestSession.exists({
        userId: req.user._id,
        sessionWindowId: windowId,
        deletedAt: null,
      })
      alreadySubmittedThisWindow = !!mine
    }

    const filter = { deletedAt: null }
    const [total, rows] = await Promise.all([
      RequestSession.countDocuments(filter),
      RequestSession.find(filter)
        .populate('userId', 'keyId role')
        .populate('approvedBy', 'keyId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ])

    const requests = rows.reverse().map(serializeRequest)
    const session = buildScheduleMeta(settings, { alreadySubmittedThisWindow })

    return ApiResponse.success(res, {
      isEnabled: session.isEnabled,
      session,
      requests,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Member: submit two edit names — once per open Sunday window.
 */
const createRequest = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings()
    if (!settings.isEnabled) {
      throw ApiError.forbidden(
        'Request session is closed. It opens every Sunday — you can send new names on the next open Sunday.',
      )
    }

    if (req.user.role === 'admin') {
      throw ApiError.badRequest('Admins manage requests — members submit name edits')
    }

    const windowId = settings.currentWindowId || 0
    if (!windowId) {
      throw ApiError.badRequest('No active session window. Ask admin to open the session.')
    }

    const name1 = normalizeName(req.body?.name1, 'First name')
    const name2 = normalizeName(req.body?.name2, 'Second name')

    if (name1.toLowerCase() === name2.toLowerCase()) {
      throw ApiError.badRequest('Please enter two different names')
    }

    const alreadyInWindow = await RequestSession.findOne({
      userId: req.user._id,
      sessionWindowId: windowId,
      deletedAt: null,
    }).lean()

    if (alreadyInWindow) {
      throw ApiError.badRequest(
        'You already sent names for this Sunday’s session. You can send new names when the session opens again next Sunday.',
      )
    }

    const created = await RequestSession.create({
      userId: req.user._id,
      name1,
      name2,
      status: 'pending',
      sessionWindowId: windowId,
    })

    const populated = await RequestSession.findById(created._id)
      .populate('userId', 'keyId role')
      .populate('approvedBy', 'keyId')
      .lean()

    return ApiResponse.created(
      res,
      {
        request: serializeRequest(populated),
        isEnabled: true,
        session: buildScheduleMeta(settings, { alreadySubmittedThisWindow: true }),
      },
      'Request sent for this Sunday’s session',
    )
  } catch (error) {
    next(error)
  }
}

/**
 * Admin: open / close the weekly session.
 * Opening always starts a new window so members can submit once again.
 */
const setRequestSessionEnabled = async (req, res, next) => {
  try {
    const isEnabled = !!req.body?.isEnabled
    const settings = await getOrCreateSettings()
    const now = new Date()

    if (isEnabled) {
      // New Sunday window — members get one fresh submission slot
      settings.isEnabled = true
      settings.currentWindowId = (settings.currentWindowId || 0) + 1
      settings.currentWindowOpenedAt = now
      settings.currentWindowClosedAt = null
    } else {
      settings.isEnabled = false
      settings.currentWindowClosedAt = now
      // Keep currentWindowId + openedAt so we know which window just closed
    }

    await settings.save()

    const session = buildScheduleMeta(settings, { alreadySubmittedThisWindow: false })

    return ApiResponse.success(
      res,
      {
        isEnabled: !!settings.isEnabled,
        session,
      },
      isEnabled
        ? `Request session opened (window #${settings.currentWindowId}) — members can each send once`
        : 'Request session closed for today — opens again next Sunday',
    )
  } catch (error) {
    next(error)
  }
}

/**
 * Admin: mark a request as approved (visible to everyone).
 */
const approveRequest = async (req, res, next) => {
  try {
    const request = await RequestSession.findOne({
      _id: req.params.id,
      deletedAt: null,
    })

    if (!request) {
      throw ApiError.notFound('Request not found')
    }

    if (request.status === 'approved') {
      const populated = await RequestSession.findById(request._id)
        .populate('userId', 'keyId role')
        .populate('approvedBy', 'keyId')
        .lean()
      return ApiResponse.success(
        res,
        { request: serializeRequest(populated) },
        'Already approved',
      )
    }

    request.status = 'approved'
    request.approvedBy = req.user._id
    request.approvedAt = new Date()
    await request.save()

    const populated = await RequestSession.findById(request._id)
      .populate('userId', 'keyId role')
      .populate('approvedBy', 'keyId')
      .lean()

    return ApiResponse.success(
      res,
      { request: serializeRequest(populated) },
      'Request approved — member edits are typically ready within 5 to 10 days',
    )
  } catch (error) {
    next(error)
  }
}

/**
 * Admin: soft-delete a request from the feed.
 */
const deleteRequest = async (req, res, next) => {
  try {
    const request = await RequestSession.findOne({
      _id: req.params.id,
      deletedAt: null,
    })

    if (!request) {
      throw ApiError.notFound('Request not found')
    }

    request.deletedAt = new Date()
    await request.save()

    return ApiResponse.success(res, null, 'Request removed')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getRequestSessionFeed,
  createRequest,
  setRequestSessionEnabled,
  approveRequest,
  deleteRequest,
}
