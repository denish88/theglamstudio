const { Contact } = require('../models')
const { ApiResponse, ApiError } = require('../utils')

const submitContact = async (req, res, next) => {
  try {
    const { name, email, subject, message } = req.body

    if (!name || !email || !message) {
      throw ApiError.badRequest('Name, email and message are required')
    }

    const contact = await Contact.create({
      name: name.trim(),
      email: email.trim(),
      subject: subject?.trim() || '',
      message: message.trim(),
      userId: req.user?._id || null,
    })

    return ApiResponse.created(res, { id: contact._id }, 'Your message has been sent successfully')
  } catch (error) {
    next(error)
  }
}

const listContacts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20))
    const skip = (page - 1) * limit
    const filter = req.query.filter

    const query = {}
    if (filter === 'read') query.isRead = true
    if (filter === 'unread') query.isRead = false

    const [contacts, total] = await Promise.all([
      Contact.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'keyId')
        .lean(),
      Contact.countDocuments(query),
    ])

    return ApiResponse.success(res, {
      contacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    next(error)
  }
}

const markAsRead = async (req, res, next) => {
  try {
    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true },
    )

    if (!contact) {
      throw ApiError.notFound('Contact query not found')
    }

    return ApiResponse.success(res, contact, 'Marked as read')
  } catch (error) {
    next(error)
  }
}

const deleteContact = async (req, res, next) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id)

    if (!contact) {
      throw ApiError.notFound('Contact query not found')
    }

    return ApiResponse.success(res, null, 'Contact query deleted')
  } catch (error) {
    next(error)
  }
}

module.exports = { submitContact, listContacts, markAsRead, deleteContact }
