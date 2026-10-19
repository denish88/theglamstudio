const { S3Client } = require('@aws-sdk/client-s3')
const { R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY } = require('./env')

/**
 * Default AWS SDK maxSockets is 50. Every proxied photo holds a socket for the
 * whole transfer (and used to also burn one on HeadObject), so a busy feed
 * queues hundreds of image requests and the site looks broken until restart.
 *
 * Keep photos on the authenticated proxy (no signed image URLs). Raise the
 * pool and rely on keep-alive reuse so R2 traffic can keep up.
 */
const R2_MAX_SOCKETS = 250

const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
  requestHandler: {
    connectionTimeout: 10_000,
    // Headers only for streaming GetObject; body is drained via pipe.
    requestTimeout: 120_000,
    httpsAgent: {
      maxSockets: R2_MAX_SOCKETS,
      keepAlive: true,
      keepAliveMsecs: 1_000,
    },
    // Warn only if we truly saturate the raised pool.
    socketAcquisitionWarningTimeout: 5_000,
  },
})

module.exports = r2Client
