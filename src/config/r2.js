const { S3Client } = require('@aws-sdk/client-s3')
const { R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY } = require('./env')

/**
 * Photo views must not hold a socket for the whole time a user is looking or
 * scrolling. imageFileCache.js downloads a miss, then serves every later view
 * from this server. socketTimeout is inactivity only: a healthy upload keeps
 * sending bytes, but a stalled R2 connection is destroyed instead of staying
 * open until the container is restarted.
 */
const R2_MAX_SOCKETS = 64

const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
  requestHandler: {
    connectionTimeout: 5_000,
    socketTimeout: 20_000,
    httpsAgent: {
      maxSockets: R2_MAX_SOCKETS,
      keepAlive: true,
      keepAliveMsecs: 1_000,
      maxFreeSockets: 16,
    },
  },
})

module.exports = r2Client
