const { Directory, Post } = require('../models')
const { ApiError, ApiResponse } = require('../utils')

const createDirectory = async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name || !name.trim()) {
      throw ApiError.badRequest('Directory name is required')
    }

    const directory = await Directory.create({ name: name.trim().toLowerCase() })

    ApiResponse.created(res, directory, 'Directory created')
  } catch (error) {
    next(error)
  }
}

const listDirectories = async (req, res, next) => {
  try {
    const filter = { deletedAt: null }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true'
    }

    const directories = await Directory.find(filter).sort({ createdAt: -1 }).lean()

    ApiResponse.success(res, directories)
  } catch (error) {
    next(error)
  }
}

const getDirectory = async (req, res, next) => {
  try {
    const directory = await Directory.findOne({ _id: req.params.id, deletedAt: null }).lean()
    if (!directory) {
      throw ApiError.notFound('Directory not found')
    }

    ApiResponse.success(res, directory)
  } catch (error) {
    next(error)
  }
}

const updateDirectory = async (req, res, next) => {
  try {
    const { name, isActive } = req.body

    const directory = await Directory.findOne({ _id: req.params.id, deletedAt: null })
    if (!directory) {
      throw ApiError.notFound('Directory not found')
    }

    if (name !== undefined) directory.name = name.trim().toLowerCase()
    if (isActive !== undefined) directory.isActive = isActive

    await directory.save()

    ApiResponse.success(res, directory, 'Directory updated')
  } catch (error) {
    next(error)
  }
}

const deleteDirectory = async (req, res, next) => {
  try {
    const directory = await Directory.findOne({ _id: req.params.id, deletedAt: null })
    if (!directory) {
      throw ApiError.notFound('Directory not found')
    }

    const postCount = await Post.countDocuments({ directory: directory._id, deletedAt: null })
    if (postCount > 0) {
      throw ApiError.badRequest(`Cannot delete: directory has ${postCount} active post(s)`)
    }

    directory.deletedAt = new Date()
    directory.isActive = false
    await directory.save()

    ApiResponse.success(res, null, 'Directory deleted')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createDirectory,
  listDirectories,
  getDirectory,
  updateDirectory,
  deleteDirectory,
}
