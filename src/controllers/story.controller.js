const { v4: uuidv4 } = require('uuid')
const { Story, User } = require('../models')
const { SITE_STORY_KEY } = require('../models/story.model')
const {
  ApiError,
  ApiResponse,
  buildMediaUrl,
  uploadToR2,
  deleteFromR2,
  buildStoryR2Key,
  createStoryImages,
} = require('../utils')
const { formatMemberKeyIdDisplay } = require('../utils/memberKeyId')

async function getSiteStory() {
  return Story.findOne({
    singletonKey: SITE_STORY_KEY,
    deletedAt: null,
  })
}

function serializeAdminStory(story, viewers = []) {
  if (!story) {
    return {
      story: null,
      views: { count: 0, viewers: [] },
    }
  }

  return {
    story: {
      _id: story._id,
      text: story.text || '',
      isActive: !!story.isActive,
      imageUrl: buildMediaUrl(story.imageKey),
      thumbnailUrl: buildMediaUrl(story.thumbnailKey),
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    },
    views: {
      count: story.views?.length || 0,
      viewers,
    },
  }
}

async function buildViewers(story) {
  if (!story?.views?.length) return []

  const userIds = story.views.map((v) => v.userId).filter(Boolean)
  const users = await User.find({ _id: { $in: userIds } })
    .select('keyId')
    .lean()

  const keyMap = new Map(
    users.map((u) => [String(u._id), formatMemberKeyIdDisplay(u.keyId) || u.keyId]),
  )

  return [...story.views]
    .sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))
    .map((v) => ({
      userId: keyMap.get(String(v.userId)) || String(v.userId),
      viewedAt: v.viewedAt,
    }))
}

async function cleanupKeys(keys) {
  await Promise.allSettled((keys || []).filter(Boolean).map((key) => deleteFromR2(key)))
}

const getStory = async (req, res, next) => {
  try {
    const story = await getSiteStory()
    const viewers = await buildViewers(story)
    ApiResponse.success(res, serializeAdminStory(story, viewers))
  } catch (error) {
    next(error)
  }
}

const createOrReplaceStory = async (req, res, next) => {
  const uploadedKeys = []

  try {
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : ''
    if (text.length > 500) {
      throw ApiError.badRequest('Story text must be 500 characters or less')
    }

    const isActive =
      req.body.isActive === undefined
        ? true
        : req.body.isActive === true ||
          req.body.isActive === 'true' ||
          req.body.isActive === '1'

    const existing = await getSiteStory()

    // Text / visibility-only update when no new image is uploaded
    if (!req.file) {
      if (!existing) {
        throw ApiError.badRequest('Story image is required')
      }

      existing.text = text
      existing.isActive = isActive
      await existing.save()

      const viewers = await buildViewers(existing)
      return ApiResponse.success(
        res,
        serializeAdminStory(existing, viewers),
        isActive ? 'Story updated and live on home' : 'Story updated',
      )
    }

    const { original, thumbnail } = await createStoryImages(req.file.buffer)

    const imageFilename = `${uuidv4()}.${original.ext}`
    const thumbFilename = `${uuidv4()}-thumb.${thumbnail.ext}`
    const imageKey = buildStoryR2Key(imageFilename)
    const thumbnailKey = buildStoryR2Key(thumbFilename)

    await uploadToR2(original.buffer, imageKey, original.contentType)
    uploadedKeys.push(imageKey)
    await uploadToR2(thumbnail.buffer, thumbnailKey, thumbnail.contentType)
    uploadedKeys.push(thumbnailKey)

    const previousKeys = existing
      ? [existing.imageKey, existing.thumbnailKey]
      : []

    const story = await Story.findOneAndUpdate(
      { singletonKey: SITE_STORY_KEY },
      {
        $set: {
          singletonKey: SITE_STORY_KEY,
          imageKey,
          thumbnailKey,
          text,
          isActive,
          views: [],
          deletedAt: null,
        },
      },
      { new: true, upsert: true, runValidators: true },
    )

    if (previousKeys.length) {
      await cleanupKeys(previousKeys)
    }

    ApiResponse.success(
      res,
      serializeAdminStory(story, []),
      isActive ? 'Story is now live on home screen' : 'Story saved',
    )
  } catch (error) {
    await cleanupKeys(uploadedKeys)
    next(error)
  }
}

const toggleStoryActive = async (req, res, next) => {
  try {
    const story = await getSiteStory()
    if (!story) {
      throw ApiError.notFound('No story found. Upload a story first.')
    }

    story.isActive = !story.isActive
    await story.save()

    const viewers = await buildViewers(story)
    ApiResponse.success(
      res,
      serializeAdminStory(story, viewers),
      story.isActive ? 'Story is now visible on home' : 'Story hidden from home',
    )
  } catch (error) {
    next(error)
  }
}

const deleteStory = async (req, res, next) => {
  try {
    const story = await getSiteStory()
    if (!story) {
      throw ApiError.notFound('No story found')
    }

    const keys = [story.imageKey, story.thumbnailKey]
    await Story.deleteOne({ _id: story._id })
    await cleanupKeys(keys)

    ApiResponse.success(res, { story: null }, 'Story deleted')
  } catch (error) {
    next(error)
  }
}

/** Active story for home circle (thumbnail only). */
const getActiveStoryForFeed = async (userId) => {
  const story = await Story.findOne({
    singletonKey: SITE_STORY_KEY,
    deletedAt: null,
    isActive: true,
  })
    .select('_id thumbnailKey views')
    .lean()

  if (!story) return null

  const viewed = (story.views || []).some(
    (v) => String(v.userId) === String(userId),
  )

  return {
    _id: story._id,
    thumbnailUrl: buildMediaUrl(story.thumbnailKey),
    viewed,
  }
}

/** Full story for the fullscreen viewer. */
const getActiveStory = async (req, res, next) => {
  try {
    const story = await Story.findOne({
      singletonKey: SITE_STORY_KEY,
      deletedAt: null,
      isActive: true,
    })
      .select('_id imageKey text views createdAt')
      .lean()

    if (!story) {
      throw ApiError.notFound('No active story')
    }

    const viewed = (story.views || []).some(
      (v) => String(v.userId) === String(req.user._id),
    )

    ApiResponse.success(res, {
      story: {
        _id: story._id,
        imageUrl: buildMediaUrl(story.imageKey),
        text: story.text || '',
        viewed,
        createdAt: story.createdAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

const markStoryViewed = async (req, res, next) => {
  try {
    // Admins can open the story, but don't inflate member view stats
    if (req.user.role === 'admin') {
      return ApiResponse.success(res, { viewed: true, viewCount: null })
    }

    const userId = req.user._id

    const story = await Story.findOne({
      singletonKey: SITE_STORY_KEY,
      deletedAt: null,
      isActive: true,
    })

    if (!story) {
      throw ApiError.notFound('No active story')
    }

    const alreadyViewed = (story.views || []).some(
      (v) => String(v.userId) === String(userId),
    )

    if (!alreadyViewed) {
      story.views.push({ userId, viewedAt: new Date() })
      await story.save()
    }

    ApiResponse.success(res, {
      viewed: true,
      viewCount: story.views.length,
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getStory,
  createOrReplaceStory,
  toggleStoryActive,
  deleteStory,
  getActiveStoryForFeed,
  getActiveStory,
  markStoryViewed,
}
