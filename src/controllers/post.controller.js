const { v4: uuidv4 } = require('uuid')
const { Post, Directory } = require('../models')
const { ApiError, ApiResponse, uploadToR2, deleteFromR2, generateSignedUrls, buildR2Key, optimizeImage } = require('../utils')
const { processInBatches } = require('../utils/processInBatches')
const { invalidateHomeStats } = require('../utils/homeStats')

const VALID_CATEGORIES = [0, 1, 2, 3, 4, 5]
const IMAGE_PROCESS_CONCURRENCY = 4

function parseBoolean(value) {
  return value === 'true' || value === true
}

function parseJsonArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function formatPostResponse(post) {
  const obj = typeof post.toObject === 'function' ? post.toObject() : { ...post }
  const keys = [...(obj.imageUrl || [])]
  obj.imageKeys = keys
  obj.imageUrl = await generateSignedUrls(keys)
  return obj
}

async function refreshDirectoryCount(directoryId) {
  if (!directoryId) return
  const count = await Post.countDocuments({ directory: directoryId, deletedAt: null })
  await Directory.findByIdAndUpdate(directoryId, { totalPictures: count })
}

async function processAndUploadImages(files) {
  return processInBatches(files, IMAGE_PROCESS_CONCURRENCY, async (file) => {
    const optimized = await optimizeImage(file.buffer)
    const filename = `${uuidv4()}.webp`
    const key = buildR2Key(filename)
    await uploadToR2(optimized, key, 'image/webp')
    return key
  })
}

const createPost = async (req, res, next) => {
  let uploadedKeys = []

  try {
    const { caption, category, directory, isWatermarked } = req.body

    if (!req.files || req.files.length === 0) {
      throw ApiError.badRequest('At least one image is required')
    }

    if (!directory) {
      throw ApiError.badRequest('Directory is required')
    }

    if (category === undefined || !VALID_CATEGORIES.includes(Number(category))) {
      throw ApiError.badRequest('Category must be 0, 1, 2, 3, 4 or 5')
    }

    const dir = await Directory.findOne({ _id: directory, deletedAt: null })
    if (!dir) {
      throw ApiError.notFound('Directory not found')
    }

    uploadedKeys = await processAndUploadImages(req.files)

    const post = await Post.create({
      imageUrl: uploadedKeys,
      caption: caption || '',
      category: Number(category),
      directory: dir._id,
      isWatermarked: parseBoolean(isWatermarked),
    })

    await refreshDirectoryCount(dir._id)

    const postObj = await formatPostResponse(post)

    invalidateHomeStats()

    ApiResponse.created(res, postObj, 'Post created')
  } catch (error) {
    if (uploadedKeys.length > 0) {
      await Promise.allSettled(uploadedKeys.map((key) => deleteFromR2(key)))
    }
    next(error)
  }
}

const listPosts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const skip = (page - 1) * limit

    const filter = { deletedAt: null }

    if (req.query.category !== undefined) {
      filter.category = Number(req.query.category)
    }
    if (req.query.directory) {
      filter.directory = req.query.directory
    }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true'
    }

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .populate('directory', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(filter),
    ])

    const postsWithSignedUrls = await Promise.all(posts.map((post) => formatPostResponse(post)))

    ApiResponse.success(res, {
      posts: postsWithSignedUrls,
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

const getPost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, deletedAt: null })
      .populate('directory', 'name')
      .lean()

    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const postObj = await formatPostResponse(post)

    ApiResponse.success(res, postObj)
  } catch (error) {
    next(error)
  }
}

const updatePost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, deletedAt: null })
    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const previousDirectoryId = post.directory?.toString()
    const { caption, category, isActive, isWatermarked, directory } = req.body

    if (caption !== undefined) post.caption = caption
    if (category !== undefined) {
      const cat = Number(category)
      if (!VALID_CATEGORIES.includes(cat)) {
        throw ApiError.badRequest('Category must be 0, 1, 2, 3, 4 or 5')
      }
      post.category = cat
    }
    if (isActive !== undefined) post.isActive = parseBoolean(isActive)
    if (isWatermarked !== undefined) post.isWatermarked = parseBoolean(isWatermarked)

    if (directory) {
      const dir = await Directory.findOne({ _id: directory, deletedAt: null })
      if (!dir) throw ApiError.notFound('Directory not found')
      post.directory = dir._id
    }

    const removeImages = parseJsonArray(req.body.removeImages)
    if (removeImages.length > 0) {
      const keysToRemove = removeImages.filter((key) => post.imageUrl.includes(key))
      if (keysToRemove.length > 0) {
        const remaining = post.imageUrl.filter((key) => !keysToRemove.includes(key))
        if (remaining.length === 0) {
          throw ApiError.badRequest('Post must have at least one image')
        }
        await Promise.allSettled(keysToRemove.map((key) => deleteFromR2(key)))
        post.imageUrl = remaining
      }
    }

    if (req.files && req.files.length > 0) {
      const newKeys = await processAndUploadImages(req.files)
      post.imageUrl = [...post.imageUrl, ...newKeys]
    }

    await post.save()

    const directoryChanged = post.directory.toString() !== previousDirectoryId
    if (directoryChanged) {
      await Promise.all([
        refreshDirectoryCount(previousDirectoryId),
        refreshDirectoryCount(post.directory),
      ])
    }

    const postObj = await formatPostResponse(post)

    ApiResponse.success(res, postObj, 'Post updated')
  } catch (error) {
    next(error)
  }
}

const updatePostCategory = async (req, res, next) => {
  try {
    const { category } = req.body

    if (category === undefined || !VALID_CATEGORIES.includes(Number(category))) {
      throw ApiError.badRequest('Category must be 0, 1, 2, 3, 4 or 5')
    }

    const post = await Post.findOne({ _id: req.params.id, deletedAt: null })
    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    post.category = Number(category)
    await post.save()

    const postObj = await formatPostResponse(post)

    ApiResponse.success(res, postObj, 'Post category updated')
  } catch (error) {
    next(error)
  }
}

const deletePost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, deletedAt: null })
    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const directoryId = post.directory

    post.deletedAt = new Date()
    post.isActive = false
    await post.save()

    await refreshDirectoryCount(directoryId)

    invalidateHomeStats()

    ApiResponse.success(res, null, 'Post deleted')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createPost,
  listPosts,
  getPost,
  updatePost,
  updatePostCategory,
  deletePost,
}
