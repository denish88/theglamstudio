const { Poll, PollVote } = require('../models')
const { ApiResponse, ApiError } = require('../utils')

const createPoll = async (req, res, next) => {
  try {
    const { question, description, options } = req.body

    if (!question || !options || options.length < 2) {
      throw ApiError.badRequest('Question and at least 2 options are required')
    }

    const pollOptions = options.map((opt) => ({
      text: typeof opt === 'string' ? opt.trim() : opt.text?.trim(),
    }))

    if (pollOptions.some((o) => !o.text)) {
      throw ApiError.badRequest('All options must have text')
    }

    const poll = await Poll.create({
      question: question.trim(),
      description: description?.trim() || '',
      options: pollOptions,
    })

    return ApiResponse.created(res, poll, 'Poll created successfully')
  } catch (error) {
    next(error)
  }
}

const listPolls = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const filter = { deletedAt: null }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true'
    }

    const [polls, total] = await Promise.all([
      Poll.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Poll.countDocuments(filter),
    ])

    return ApiResponse.success(res, {
      polls,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    next(error)
  }
}

const togglePollActive = async (req, res, next) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, deletedAt: null })
    if (!poll) throw ApiError.notFound('Poll not found')

    poll.isActive = !poll.isActive
    await poll.save()

    return ApiResponse.success(res, { isActive: poll.isActive }, `Poll ${poll.isActive ? 'activated' : 'deactivated'}`)
  } catch (error) {
    next(error)
  }
}

const deletePoll = async (req, res, next) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, deletedAt: null })
    if (!poll) throw ApiError.notFound('Poll not found')

    poll.deletedAt = new Date()
    poll.isActive = false
    await poll.save()

    return ApiResponse.success(res, null, 'Poll deleted')
  } catch (error) {
    next(error)
  }
}

const getPollResults = async (req, res, next) => {
  try {
    const poll = await Poll.findOne({ _id: req.params.id, deletedAt: null }).lean()
    if (!poll) throw ApiError.notFound('Poll not found')

    const votes = await PollVote.find({ poll: poll._id })
      .populate('user', 'keyId')
      .sort({ createdAt: -1 })
      .lean()

    return ApiResponse.success(res, { poll, votes })
  } catch (error) {
    next(error)
  }
}

const getActivePolls = async (req, res, next) => {
  try {
    const userId = req.user._id

    const polls = await Poll.find({ isActive: true, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean()

    const pollIds = polls.map((p) => p._id)
    const userVotes = await PollVote.find({ user: userId, poll: { $in: pollIds } }).lean()
    const voteMap = {}
    userVotes.forEach((v) => {
      voteMap[v.poll.toString()] = v.option.toString()
    })

    const result = polls.map((poll) => ({
      ...poll,
      votedOptionId: voteMap[poll._id.toString()] || null,
      hasVoted: !!voteMap[poll._id.toString()],
    }))

    return ApiResponse.success(res, { polls: result })
  } catch (error) {
    next(error)
  }
}

const votePoll = async (req, res, next) => {
  try {
    const userId = req.user._id
    const pollId = req.params.id
    const { optionId } = req.body

    if (!optionId) throw ApiError.badRequest('Option is required')

    const poll = await Poll.findOne({ _id: pollId, isActive: true, deletedAt: null })
    if (!poll) throw ApiError.notFound('Poll not found or inactive')

    const option = poll.options.id(optionId)
    if (!option) throw ApiError.badRequest('Invalid option')

    const existing = await PollVote.findOne({ poll: pollId, user: userId })
    if (existing) throw ApiError.badRequest('You have already voted on this poll')

    await PollVote.create({ poll: pollId, user: userId, option: optionId })

    option.votes += 1
    poll.totalVotes += 1
    await poll.save()

    const updatedPoll = await Poll.findById(pollId).lean()

    return ApiResponse.success(res, {
      poll: {
        ...updatedPoll,
        votedOptionId: optionId,
        hasVoted: true,
      },
    }, 'Vote submitted successfully')
  } catch (error) {
    next(error)
  }
}

module.exports = { createPoll, listPolls, togglePollActive, deletePoll, getPollResults, getActivePolls, votePoll }
