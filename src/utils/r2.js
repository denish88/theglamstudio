const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const r2Client = require('../config/r2')
const { R2_BUCKET } = require('../config/env')

const SIGNED_URL_EXPIRY = 6 * 60 * 60

async function uploadToR2(buffer, key, contentType = 'image/webp') {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  })

  await r2Client.send(command)
  return key
}

async function deleteFromR2(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    })
    await r2Client.send(command)
  } catch {
    // Silently fail — object may already be deleted
  }
}

function buildMediaUrl(key) {
  if (!key) return null
  return `/api/v1/media/${key}`
}

function buildMediaUrls(keys) {
  if (!keys || keys.length === 0) return []
  return keys.map((key) => buildMediaUrl(key))
}

function buildR2Key(filename) {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `posts/${year}/${month}/${filename}`
}

function buildStoryR2Key(filename) {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `stories/${year}/${month}/${filename}`
}

function buildGiftBoxR2Key(filename) {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `giftboxes/${year}/${month}/${filename}`
}

async function generateSignedImageUrl(key) {
  if (!key) return null
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
  return getSignedUrl(r2Client, command, { expiresIn: SIGNED_URL_EXPIRY })
}

async function generateSignedUrls(keys) {
  if (!keys || keys.length === 0) return []
  return Promise.all(keys.map((key) => generateSignedImageUrl(key)))
}

module.exports = {
  uploadToR2,
  deleteFromR2,
  buildMediaUrl,
  buildMediaUrls,
  buildR2Key,
  buildStoryR2Key,
  buildGiftBoxR2Key,
  generateSignedImageUrl,
  generateSignedUrls,
}
