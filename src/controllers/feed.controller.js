const mongoose = require('mongoose')
const { Post, Like, Directory } = require('../models')
const { ApiError, ApiResponse, buildMediaUrls, getISTDayBounds } = require('../utils')
const { getHomeStats } = require('../utils/homeStats')
const { getActiveStoryForFeed } = require('./story.controller')

const HOME_PREVIEW_LIMIT = 3

const getHomeFeed = async (req, res, next) => {
  try {
    const { start, end } = getISTDayBounds()
    const postFilter = {
      deletedAt: null,
      isActive: true,
      createdAt: { $gte: start, $lte: end },
    }
    const fetchLimit = HOME_PREVIEW_LIMIT + 1

    const [stats, posts, story] = await Promise.all([
      getHomeStats(),
      Post.find(postFilter)
        .select('_id imageUrl category createdAt')
        .sort({ _id: -1 })
        .limit(fetchLimit)
        .lean(),
      getActiveStoryForFeed(req.user._id),
    ])

    const hasMoreToday = posts.length > HOME_PREVIEW_LIMIT
    const previewPosts = hasMoreToday ? posts.slice(0, HOME_PREVIEW_LIMIT) : posts

    const latestPosts = previewPosts.map((post) => {
      const imageCount = post.imageUrl?.length || 0
      const firstKey = imageCount > 0 ? post.imageUrl[0] : null

      return {
        _id: post._id,
        category: post.category,
        createdAt: post.createdAt,
        imageUrl: firstKey ? buildMediaUrls([firstKey]) : [],
        imageCount,
      }
    })

    ApiResponse.success(res, {
      totalPosts: stats.totalPosts,
      announcement: stats.announcement,
      story,
      latestPosts,
      hasMoreToday,
    })
  } catch (error) {
    next(error)
  }
}

const getPosts = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30))
    const cursor = req.query.cursor || null
    const userId = req.user._id

    const filter = { deletedAt: null, isActive: true }

    if (req.query.category !== undefined) {
      const cat = Number(req.query.category)
      if (![0, 1, 2, 3, 4, 5].includes(cat)) {
        throw ApiError.badRequest('Category must be 0, 1, 2, 3, 4 or 5')
      }
      filter.category = cat
    }

    if (req.query.directory) {
      if (!mongoose.Types.ObjectId.isValid(req.query.directory)) {
        throw ApiError.badRequest('Invalid directory')
      }
      filter.directory = req.query.directory
    }

    if (req.query.today === 'true') {
      const { start, end } = getISTDayBounds()
      filter.createdAt = { $gte: start, $lte: end }
    }

    if (cursor) {
      filter._id = { $lt: cursor }
    }

    const posts = await Post.find(filter)
      .populate('directory', 'name')
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean()

    const hasMore = posts.length > limit
    if (hasMore) posts.pop()

    const postIds = posts.map((p) => p._id)
    const userLikes = await Like.find({ user: userId, post: { $in: postIds } })
      .select('post')
      .lean()

    const likedSet = new Set(userLikes.map((l) => l.post.toString()))

    const postsWithProxyUrls = posts.map((p) => ({
      ...p,
      imageUrl: buildMediaUrls(p.imageUrl),
      isLiked: likedSet.has(p._id.toString()),
    }))

    const nextCursor = posts.length > 0 ? posts[posts.length - 1]._id : null

    ApiResponse.success(res, {
      posts: postsWithProxyUrls,
      pagination: {
        nextCursor: hasMore ? nextCursor : null,
        hasMore,
        limit,
      },
    })
  } catch (error) {
    next(error)
  }
}

const getPostById = async (req, res, next) => {
  try {
    const userId = req.user._id

    const post = await Post.findOne({
      _id: req.params.id,
      deletedAt: null,
      isActive: true,
    })
      .populate('directory', 'name')
      .lean()

    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const liked = await Like.exists({ user: userId, post: post._id })
    post.isLiked = !!liked
    post.imageUrl = buildMediaUrls(post.imageUrl)

    ApiResponse.success(res, post)
  } catch (error) {
    next(error)
  }
}

const getDirectories = async (req, res, next) => {
  try {
    const match = { deletedAt: null, isActive: true }

    if (req.query.category !== undefined) {
      const cat = Number(req.query.category)
      if (![0, 1, 2, 3, 4, 5].includes(cat)) {
        throw ApiError.badRequest('Category must be 0, 1, 2, 3, 4 or 5')
      }
      match.category = cat
    }

    const grouped = await Post.aggregate([
      { $match: match },
      { $group: { _id: '$directory', count: { $sum: 1 } } },
    ])

    const dirIds = grouped.map((g) => g._id).filter(Boolean)
    const directories = await Directory.find({
      _id: { $in: dirIds },
      deletedAt: null,
      isActive: true,
    })
      .select('name')
      .lean()

    const countMap = new Map(grouped.map((g) => [String(g._id), g.count]))

    const result = directories
      .map((d) => ({
        _id: d._id,
        name: d.name,
        count: countMap.get(String(d._id)) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    ApiResponse.success(res, { directories: result })
  } catch (error) {
    next(error)
  }
}

const getPostStats = async (req, res, next) => {
  try {
    const stats = await getHomeStats()
    ApiResponse.success(res, { totalPosts: stats.totalPosts })
  } catch (error) {
    next(error)
  }
}

const toggleLike = async (req, res, next) => {
  try {
    const userId = req.user._id
    const postId = req.params.id

    const post = await Post.findOne({ _id: postId, deletedAt: null, isActive: true })
    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const existingLike = await Like.findOne({ user: userId, post: postId })

    let isLiked
    if (existingLike) {
      await Like.deleteOne({ _id: existingLike._id })
      await Post.findByIdAndUpdate(postId, { $inc: { totalLikes: -1 } })
      isLiked = false
    } else {
      await Like.create({ user: userId, post: postId })
      await Post.findByIdAndUpdate(postId, { $inc: { totalLikes: 1 } })
      isLiked = true
    }

    const updatedPost = await Post.findById(postId).select('totalLikes').lean()

    ApiResponse.success(res, {
      isLiked,
      totalLikes: updatedPost.totalLikes,
    }, isLiked ? 'Post liked' : 'Post unliked')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getHomeFeed,
  getPosts,
  getPostById,
  getPostStats,
  getDirectories,
  toggleLike,
}
