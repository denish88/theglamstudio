const { v4: uuidv4 } = require('uuid')
const path = require('path')
const { Post, Directory } = require('../models')
const {
  ApiError,
  ApiResponse,
  uploadToR2,
  deleteFromR2,
  buildMediaUrl,
  buildMediaUrls,
  buildR2Key,
  buildVideoR2Key,
  optimizeImage,
} = require('../utils')
const { processInBatches } = require('../utils/processInBatches')
const { invalidateHomeStats } = require('../utils/homeStats')
const { sanitizeCaption } = require('../utils/sanitizeCaption')
const { notifyNewPostPublished } = require('../utils/webPush')
const { MAX_IMAGE_SIZE } = require('../middlewares/upload.middleware')

const VALID_CATEGORIES = Post.VALID_CATEGORIES || [0, 1, 2, 3, 4, 5, 6, 7]
const VIDEO_CATEGORIES = Post.VIDEO_CATEGORIES || [6, 7]
const IMAGE_CATEGORIES = Post.IMAGE_CATEGORIES || [0, 1, 2, 3, 4, 5]
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

function categoryErrorMessage() {
  return 'Category must be 0–7'
}

function formatPostResponse(post) {
  const obj = typeof post.toObject === 'function' ? post.toObject() : { ...post }
  const keys = [...(obj.imageUrl || [])]
  obj.imageKeys = keys
  obj.imageUrl = buildMediaUrls(keys)

  const videoKey = obj.videoUrl || null
  obj.videoKey = videoKey
  obj.videoUrl = videoKey ? buildMediaUrl(videoKey) : null
  obj.mediaType = obj.mediaType || (videoKey ? 'video' : 'image')

  return obj
}

async function refreshDirectoryCount(directoryId) {
  if (!directoryId) return
  const count = await Post.countDocuments({ directory: directoryId, deletedAt: null })
  await Directory.findByIdAndUpdate(directoryId, { totalPictures: count })
}

async function processAndUploadImages(files) {
  return processInBatches(files, IMAGE_PROCESS_CONCURRENCY, async (file) => {
    if (file.size > MAX_IMAGE_SIZE) {
      throw ApiError.badRequest('Each image must be 20 MB or smaller')
    }
    const { buffer, ext, contentType } = await optimizeImage(file.buffer, file.mimetype)
    const filename = `${uuidv4()}.${ext}`
    const key = buildR2Key(filename)
    await uploadToR2(buffer, key, contentType)
    return key
  })
}

async function processAndUploadVideo(file) {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '') || 'mp4'
  const contentType = file.mimetype || (ext === 'webm' ? 'video/webm' : 'video/mp4')
  const filename = `${uuidv4()}.${ext === 'webm' ? 'webm' : 'mp4'}`
  const key = buildVideoR2Key(filename)
  await uploadToR2(file.buffer, key, contentType)
  return key
}

function getUploadedImages(req) {
  if (Array.isArray(req.files)) return req.files
  if (req.files?.images) return req.files.images
  return []
}

function getUploadedVideo(req) {
  if (req.files?.video?.[0]) return req.files.video[0]
  return null
}

const createPost = async (req, res, next) => {
  let uploadedKeys = []
  let uploadedVideoKey = null

  try {
    const { caption, category, directory, isWatermarked } = req.body
    const mediaType = String(req.body.mediaType || 'image').toLowerCase() === 'video'
      ? 'video'
      : 'image'

    if (!directory) {
      throw ApiError.badRequest('Directory is required')
    }

    if (category === undefined || !VALID_CATEGORIES.includes(Number(category))) {
      throw ApiError.badRequest(categoryErrorMessage())
    }

    const cat = Number(category)
    const dir = await Directory.findOne({ _id: directory, deletedAt: null })
    if (!dir) {
      throw ApiError.notFound('Directory not found')
    }

    let post

    if (mediaType === 'video') {
      if (!VIDEO_CATEGORIES.includes(cat)) {
        throw ApiError.badRequest('Video posts must use Actress Videos or Model Videos category')
      }

      const videoFile = getUploadedVideo(req)
      if (!videoFile) {
        throw ApiError.badRequest('A video file is required')
      }

      uploadedVideoKey = await processAndUploadVideo(videoFile)
      uploadedKeys = [uploadedVideoKey]

      post = await Post.create({
        mediaType: 'video',
        imageUrl: [],
        videoUrl: uploadedVideoKey,
        caption: sanitizeCaption(caption),
        category: cat,
        directory: dir._id,
        isWatermarked: parseBoolean(isWatermarked),
      })
    } else {
      if (!IMAGE_CATEGORIES.includes(cat)) {
        throw ApiError.badRequest('Photo posts must use a photo category (0–5)')
      }

      const images = getUploadedImages(req)
      if (!images.length) {
        throw ApiError.badRequest('At least one image is required')
      }

      uploadedKeys = await processAndUploadImages(images)

      post = await Post.create({
        mediaType: 'image',
        imageUrl: uploadedKeys,
        videoUrl: null,
        caption: sanitizeCaption(caption),
        category: cat,
        directory: dir._id,
        isWatermarked: parseBoolean(isWatermarked),
      })
    }

    await refreshDirectoryCount(dir._id)

    const postObj = formatPostResponse(post)

    invalidateHomeStats()
    notifyNewPostPublished(postObj)

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
    if (req.query.mediaType === 'image' || req.query.mediaType === 'video') {
      filter.mediaType = req.query.mediaType
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

    const formattedPosts = posts.map((post) => formatPostResponse(post))

    ApiResponse.success(res, {
      posts: formattedPosts,
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

    ApiResponse.success(res, formatPostResponse(post))
  } catch (error) {
    next(error)
  }
}

const updatePost = async (req, res, next) => {
  let newVideoKey = null

  try {
    const post = await Post.findOne({ _id: req.params.id, deletedAt: null })
    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const previousDirectoryId = post.directory?.toString()
    const { caption, category, isActive, isWatermarked, directory } = req.body
    const mediaType = post.mediaType || 'image'

    if (caption !== undefined) post.caption = sanitizeCaption(caption)
    if (category !== undefined) {
      const cat = Number(category)
      if (!VALID_CATEGORIES.includes(cat)) {
        throw ApiError.badRequest(categoryErrorMessage())
      }
      if (mediaType === 'video' && !VIDEO_CATEGORIES.includes(cat)) {
        throw ApiError.badRequest('Video posts must use Actress Videos or Model Videos category')
      }
      if (mediaType === 'image' && !IMAGE_CATEGORIES.includes(cat)) {
        throw ApiError.badRequest('Photo posts must use a photo category (0–5)')
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

    if (mediaType === 'video') {
      const videoFile = getUploadedVideo(req)
      if (videoFile) {
        newVideoKey = await processAndUploadVideo(videoFile)
        const previous = post.videoUrl
        post.videoUrl = newVideoKey
        if (previous) {
          await deleteFromR2(previous)
        }
      }
    } else {
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

      const images = getUploadedImages(req)
      if (images.length > 0) {
        const newKeys = await processAndUploadImages(images)
        post.imageUrl = [...post.imageUrl, ...newKeys]
      }
    }

    await post.save()

    const directoryChanged = post.directory.toString() !== previousDirectoryId
    if (directoryChanged) {
      await Promise.all([
        refreshDirectoryCount(previousDirectoryId),
        refreshDirectoryCount(post.directory),
      ])
    }

    ApiResponse.success(res, formatPostResponse(post), 'Post updated')
  } catch (error) {
    if (newVideoKey) {
      await deleteFromR2(newVideoKey).catch(() => {})
    }
    next(error)
  }
}

const updatePostCategory = async (req, res, next) => {
  try {
    const { category } = req.body

    if (category === undefined || !VALID_CATEGORIES.includes(Number(category))) {
      throw ApiError.badRequest(categoryErrorMessage())
    }

    const post = await Post.findOne({ _id: req.params.id, deletedAt: null })
    if (!post) {
      throw ApiError.notFound('Post not found')
    }

    const cat = Number(category)
    const mediaType = post.mediaType || 'image'
    if (mediaType === 'video' && !VIDEO_CATEGORIES.includes(cat)) {
      throw ApiError.badRequest('Video posts must use Actress Videos or Model Videos category')
    }
    if (mediaType === 'image' && !IMAGE_CATEGORIES.includes(cat)) {
      throw ApiError.badRequest('Photo posts must use a photo category (0–5)')
    }

    post.category = cat
    await post.save()

    ApiResponse.success(res, formatPostResponse(post), 'Post category updated')
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
  formatPostResponse,
}
