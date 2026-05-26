const { Post, Like } = require('../models')
const { ApiError, ApiResponse, buildMediaUrls } = require('../utils')

const getPosts = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30))
    const cursor = req.query.cursor || null
    const userId = req.user._id

    const filter = { deletedAt: null, isActive: true }

    if (req.query.category !== undefined) {
      const cat = Number(req.query.category)
      if (![0, 1, 2, 3].includes(cat)) {
        throw ApiError.badRequest('Category must be 0, 1, 2 or 3')
      }
      filter.category = cat
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
  getPosts,
  getPostById,
  toggleLike,
}
