const { v4: uuidv4 } = require('uuid')
const { GiftBox } = require('../models')
const {
  SITE_GIFT_BOX_KEY,
  MAX_GIFT_IMAGES,
} = require('../models/giftBox.model')
const {
  ApiError,
  ApiResponse,
  buildMediaUrl,
  uploadToR2,
  deleteFromR2,
  buildGiftBoxR2Key,
  createGiftBoxImages,
} = require('../utils')

async function getSiteGiftBox() {
  return GiftBox.findOne({
    singletonKey: SITE_GIFT_BOX_KEY,
    deletedAt: null,
  })
}

function serializeImage(image) {
  return {
    _id: image._id,
    imageUrl: buildMediaUrl(image.imageKey),
    thumbnailUrl: buildMediaUrl(image.thumbnailKey),
    createdAt: image.createdAt,
  }
}

function serializeAdminGiftBox(giftBox) {
  if (!giftBox) {
    return { giftBox: null }
  }

  return {
    giftBox: {
      _id: giftBox._id,
      isActive: !!giftBox.isActive,
      imageCount: giftBox.images?.length || 0,
      images: (giftBox.images || []).map(serializeImage),
      createdAt: giftBox.createdAt,
      updatedAt: giftBox.updatedAt,
    },
  }
}

async function cleanupKeys(keys) {
  await Promise.allSettled((keys || []).filter(Boolean).map((key) => deleteFromR2(key)))
}

const getGiftBox = async (req, res, next) => {
  try {
    const giftBox = await getSiteGiftBox()
    ApiResponse.success(res, serializeAdminGiftBox(giftBox))
  } catch (error) {
    next(error)
  }
}

const saveGiftBox = async (req, res, next) => {
  const uploadedKeys = []

  try {
    const isActive =
      req.body.isActive === undefined
        ? true
        : req.body.isActive === true ||
          req.body.isActive === 'true' ||
          req.body.isActive === '1'

    const files = Array.isArray(req.files) ? req.files : []
    const existing = await getSiteGiftBox()

    if (!files.length) {
      if (!existing) {
        throw ApiError.badRequest('Upload at least one gift image')
      }

      existing.isActive = isActive
      // Drop legacy title field if present on older documents
      if (existing.title != null) existing.set('title', undefined)
      await existing.save()
      return ApiResponse.success(
        res,
        serializeAdminGiftBox(existing),
        isActive ? 'Gift box updated and live on home' : 'Gift box updated',
      )
    }

    const currentCount = existing?.images?.length || 0
    if (currentCount + files.length > MAX_GIFT_IMAGES) {
      throw ApiError.badRequest(
        `Gift box can have at most ${MAX_GIFT_IMAGES} images (currently ${currentCount})`,
      )
    }

    const newImages = []
    for (const file of files) {
      const { original, thumbnail } = await createGiftBoxImages(file.buffer)

      const imageFilename = `${uuidv4()}.${original.ext}`
      const thumbFilename = `${uuidv4()}-thumb.${thumbnail.ext}`
      const imageKey = buildGiftBoxR2Key(imageFilename)
      const thumbnailKey = buildGiftBoxR2Key(thumbFilename)

      await uploadToR2(original.buffer, imageKey, original.contentType)
      uploadedKeys.push(imageKey)
      await uploadToR2(thumbnail.buffer, thumbnailKey, thumbnail.contentType)
      uploadedKeys.push(thumbnailKey)

      newImages.push({ imageKey, thumbnailKey })
    }

    let giftBox
    if (existing) {
      existing.isActive = isActive
      existing.images.push(...newImages)
      existing.deletedAt = null
      if (existing.title != null) existing.set('title', undefined)
      giftBox = await existing.save()
    } else {
      giftBox = await GiftBox.create({
        singletonKey: SITE_GIFT_BOX_KEY,
        isActive,
        images: newImages,
        deletedAt: null,
      })
    }

    ApiResponse.success(
      res,
      serializeAdminGiftBox(giftBox),
      isActive ? 'Gift images added — live on home' : 'Gift images saved',
    )
  } catch (error) {
    await cleanupKeys(uploadedKeys)
    next(error)
  }
}

const deleteGiftImage = async (req, res, next) => {
  try {
    const { imageId } = req.params
    const giftBox = await getSiteGiftBox()
    if (!giftBox) {
      throw ApiError.notFound('No gift box found')
    }

    const image = giftBox.images.id(imageId)
    if (!image) {
      throw ApiError.notFound('Gift image not found')
    }

    const keys = [image.imageKey, image.thumbnailKey]
    image.deleteOne()
    await giftBox.save()
    await cleanupKeys(keys)

    ApiResponse.success(res, serializeAdminGiftBox(giftBox), 'Gift image removed')
  } catch (error) {
    next(error)
  }
}

const toggleGiftBoxActive = async (req, res, next) => {
  try {
    const giftBox = await getSiteGiftBox()
    if (!giftBox) {
      throw ApiError.notFound('No gift box found. Upload images first.')
    }
    if (!(giftBox.images?.length > 0)) {
      throw ApiError.badRequest('Add at least one image before showing on home')
    }

    giftBox.isActive = !giftBox.isActive
    await giftBox.save()

    ApiResponse.success(
      res,
      serializeAdminGiftBox(giftBox),
      giftBox.isActive ? 'Gift box is now visible on home' : 'Gift box hidden from home',
    )
  } catch (error) {
    next(error)
  }
}

const deleteGiftBox = async (req, res, next) => {
  try {
    const giftBox = await getSiteGiftBox()
    if (!giftBox) {
      throw ApiError.notFound('No gift box found')
    }

    const keys = (giftBox.images || []).flatMap((img) => [
      img.imageKey,
      img.thumbnailKey,
    ])

    await GiftBox.deleteOne({ _id: giftBox._id })
    await cleanupKeys(keys)

    ApiResponse.success(res, { giftBox: null }, 'Gift box deleted')
  } catch (error) {
    next(error)
  }
}

/** Compact gift box for home feed icon. */
const getActiveGiftBoxForFeed = async () => {
  const giftBox = await GiftBox.findOne({
    singletonKey: SITE_GIFT_BOX_KEY,
    deletedAt: null,
    isActive: true,
    'images.0': { $exists: true },
  })
    .select('_id images')
    .lean()

  if (!giftBox) return null

  return {
    _id: giftBox._id,
    imageCount: giftBox.images?.length || 0,
  }
}

/** Full gift images for the member popup. */
const getActiveGiftBox = async (req, res, next) => {
  try {
    const giftBox = await GiftBox.findOne({
      singletonKey: SITE_GIFT_BOX_KEY,
      deletedAt: null,
      isActive: true,
      'images.0': { $exists: true },
    })
      .select('_id images createdAt')
      .lean()

    if (!giftBox) {
      throw ApiError.notFound('No active gift box')
    }

    ApiResponse.success(res, {
      giftBox: {
        _id: giftBox._id,
        imageCount: giftBox.images.length,
        images: giftBox.images.map(serializeImage),
        createdAt: giftBox.createdAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getGiftBox,
  saveGiftBox,
  deleteGiftImage,
  toggleGiftBoxActive,
  deleteGiftBox,
  getActiveGiftBoxForFeed,
  getActiveGiftBox,
  MAX_GIFT_IMAGES,
}
