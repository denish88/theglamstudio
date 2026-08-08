const multer = require('multer')
const path = require('path')

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp']
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/webm']
const ALLOWED_VIDEO_EXTS = ['.mp4', '.webm']

const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024 // 100 MB

const storage = multer.memoryStorage()

const imageFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (ALLOWED_IMAGE_EXTS.includes(ext) && ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Only image files (jpg, jpeg, png, webp) are allowed'), false)
  }
}

const postMediaFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()

  if (file.fieldname === 'video') {
    if (ALLOWED_VIDEO_EXTS.includes(ext) && ALLOWED_VIDEO_MIMES.includes(file.mimetype)) {
      return cb(null, true)
    }
    return cb(new Error('Only video files (mp4, webm) are allowed'), false)
  }

  if (file.fieldname === 'images') {
    if (ALLOWED_IMAGE_EXTS.includes(ext) && ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      return cb(null, true)
    }
    return cb(new Error('Only image files (jpg, jpeg, png, webp) are allowed'), false)
  }

  return cb(new Error('Unexpected upload field'), false)
}

const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 20,
  },
})

/** Images and/or a single video for post create/update */
const uploadPostMedia = multer({
  storage,
  fileFilter: postMediaFileFilter,
  limits: {
    fileSize: MAX_VIDEO_SIZE,
    files: 21,
  },
})

module.exports = upload
module.exports.uploadPostMedia = uploadPostMedia
module.exports.MAX_IMAGE_SIZE = MAX_IMAGE_SIZE
module.exports.MAX_VIDEO_SIZE = MAX_VIDEO_SIZE
module.exports.ALLOWED_VIDEO_MIMES = ALLOWED_VIDEO_MIMES
