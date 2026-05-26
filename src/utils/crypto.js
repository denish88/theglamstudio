const crypto = require('crypto')
const { CRYPTO_SECRET } = require('../config/env')

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const SALT = 'theglamclub-salt'
const ITERATIONS = 100000
const KEY_LENGTH = 32

let _derivedKey = null

function getDerivedKey() {
  if (!_derivedKey) {
    _derivedKey = crypto.pbkdf2Sync(CRYPTO_SECRET, SALT, ITERATIONS, KEY_LENGTH, 'sha256')
  }
  return _derivedKey
}

function encrypt(data) {
  try {
    const key = getDerivedKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const plaintext = JSON.stringify(data)

    const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    const combined = Buffer.concat([iv, encrypted, authTag])
    return combined.toString('base64')
  } catch {
    return null
  }
}

function decrypt(encryptedBase64) {
  try {
    const key = getDerivedKey()
    const combined = Buffer.from(encryptedBase64, 'base64')

    const iv = combined.subarray(0, IV_LENGTH)
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH)
    const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(decrypted.toString('utf8'))
  } catch {
    return null
  }
}

function encryptString(str) {
  try {
    const key = getDerivedKey()
    const iv = crypto.randomBytes(IV_LENGTH)

    const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    const encrypted = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    return Buffer.concat([iv, encrypted, authTag]).toString('base64')
  } catch {
    return null
  }
}

function decryptString(encryptedBase64) {
  try {
    const key = getDerivedKey()
    const combined = Buffer.from(encryptedBase64, 'base64')

    const iv = combined.subarray(0, IV_LENGTH)
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH)
    const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

module.exports = { encrypt, decrypt, encryptString, decryptString }
