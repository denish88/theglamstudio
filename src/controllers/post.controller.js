const { v4: uuidv4 } = require('uuid')
const { Post, Directory } = require('../models')
const { ApiError, ApiResponse, uploadToR2, deleteFromR2, buildMediaUrls, generateSignedUrls, buildR2Key, optimizeImage } = require('../utils')

async function processAndUploadImages(files) {
  const uploadPromises = files.map(async (file) => {
    const optimized = await optimizeImage(file.buffer)
    const filename = `${uuidv4()}.webp`
    const key = buildR2Key(filename)
    await uploadToR2(optimized, key, 'image/webp')
    return key
  })

  return Promise.all(uploadPromises)
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

    if (category === undefined || ![0, 1, 2, 3].includes(Number(category))) {
      throw ApiError.badRequest('Category must be 0, 1, 2 or 3')
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
      isWatermarked: isWatermarked === 'true' || isWatermarked === true,
    })

    dir.totalPictures = await Post.countDocuments({ directory: dir._id, deletedAt: null })
    await dir.save()

    const postObj = post.toObject()
    postObj.imageUrl = await generateSignedUrls(uploadedKeys)

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

    const postsWithSignedUrls = await Promise.all(
      posts.map(async (post) => ({
        ...post,
        imageUrl: await generateSignedUrls(post.imageUrl),
      })),
    )

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

    post.imageUrl = await generateSignedUrls(post.imageUrl)

    ApiResponse.success(res, post)
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

    const { caption, category, isActive, isWatermarked, directory } = req.body

    if (caption !== undefined) post.caption = caption
    if (category !== undefined) post.category = Number(category)
    if (isActive !== undefined) post.isActive = isActive
    if (isWatermarked !== undefined) {
      post.isWatermarked = isWatermarked === 'true' || isWatermarked === true
    }

    if (directory) {
      const dir = await Directory.findOne({ _id: directory, deletedAt: null })
      if (!dir) throw ApiError.notFound('Directory not found')
      post.directory = dir._id
    }

    if (req.files && req.files.length > 0) {
      const newKeys = await processAndUploadImages(req.files)
      post.imageUrl = [...post.imageUrl, ...newKeys]
    }

    await post.save()

    const postObj = post.toObject()
    postObj.imageUrl = await generateSignedUrls(postObj.imageUrl)

    ApiResponse.success(res, postObj, 'Post updated')
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

    post.deletedAt = new Date()
    post.isActive = false
    await post.save()

    if (post.directory) {
      const count = await Post.countDocuments({ directory: post.directory, deletedAt: null })
      await Directory.findByIdAndUpdate(post.directory, { totalPictures: count })
    }

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
  deletePost,
}
