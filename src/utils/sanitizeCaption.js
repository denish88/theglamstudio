const sanitizeHtml = require('sanitize-html')

const CAPTION_MAX_LENGTH = 5000

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'a', 'blockquote', 'h2', 'h3',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    p: ['style', 'class'],
    h2: ['style', 'class'],
    h3: ['style', 'class'],
    '*': ['style', 'class'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    }),
  },
}

function stripToText(html) {
  return sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, ' ')
    .trim()
}

/**
 * Sanitize caption HTML from the rich text editor before persistence.
 */
function sanitizeCaption(raw) {
  if (raw == null) return ''
  const input = String(raw)
  if (!input.trim()) return ''

  const cleaned = sanitizeHtml(input, SANITIZE_OPTIONS).trim()
  if (!stripToText(cleaned)) return ''

  if (cleaned.length > CAPTION_MAX_LENGTH) {
    return cleaned.slice(0, CAPTION_MAX_LENGTH)
  }

  return cleaned
}

module.exports = {
  sanitizeCaption,
  CAPTION_MAX_LENGTH,
}
