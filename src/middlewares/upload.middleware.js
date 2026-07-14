const multer = require('multer')
const path = require('path')

const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB per file

const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  const allowed = ['.jpg', '.jpeg', '.png', '.webp']

  if (allowed.includes(ext) && ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Only image files (jpg, jpeg, png, webp) are allowed'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 20,
  },
})

module.exports = upload
