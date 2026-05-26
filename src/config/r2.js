const { S3Client } = require('@aws-sdk/client-s3')
const { R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY } = require('./env')

const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
})

module.exports = r2Client
