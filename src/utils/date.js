function getISTDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const y = parts.find((p) => p.type === 'year').value
  const m = parts.find((p) => p.type === 'month').value
  const d = parts.find((p) => p.type === 'day').value

  return { y, m, d, dateKey: `${y}-${m}-${d}` }
}

function getISTDayBounds(date = new Date()) {
  const { y, m, d } = getISTDateParts(date)

  return {
    start: new Date(`${y}-${m}-${d}T00:00:00+05:30`),
    end: new Date(`${y}-${m}-${d}T23:59:59.999+05:30`),
  }
}

/** Calendar date string for Asia/Kolkata, e.g. "2026-09-13" */
function getISTDateKey(date = new Date()) {
  return getISTDateParts(date).dateKey
}

function getISTMonthBounds(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const y = parts.find((p) => p.type === 'year').value
  const m = parts.find((p) => p.type === 'month').value

  const lastDay = new Date(Number(y), Number(m), 0).getDate()
  const day = String(lastDay).padStart(2, '0')

  return {
    start: new Date(`${y}-${m}-01T00:00:00+05:30`),
    end: new Date(`${y}-${m}-${day}T23:59:59.999+05:30`),
    label: new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'long',
      year: 'numeric',
    }).format(date),
  }
}

/** Weekday 0=Sun … 6=Sat in Asia/Kolkata */
function getISTWeekday(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(date)
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekday] ?? 0
}

/**
 * Next Sunday (IST calendar). If today is Sunday and includeToday is true, returns today.
 * Otherwise returns the upcoming Sunday (never "today" when includeToday is false).
 */
function getNextSundayIST(date = new Date(), { includeToday = false } = {}) {
  const weekday = getISTWeekday(date)
  let daysAhead = (7 - weekday) % 7
  if (daysAhead === 0 && !includeToday) daysAhead = 7

  const { y, m, d } = getISTDateParts(date)
  const noonIstMs = Date.parse(`${y}-${m}-${d}T12:00:00+05:30`)
  const target = new Date(noonIstMs + daysAhead * 24 * 60 * 60 * 1000)
  const parts = getISTDateParts(target)

  return {
    dateKey: parts.dateKey,
    start: new Date(`${parts.y}-${parts.m}-${parts.d}T00:00:00+05:30`),
    end: new Date(`${parts.y}-${parts.m}-${parts.d}T23:59:59.999+05:30`),
  }
}

module.exports = {
  getISTDayBounds,
  getISTMonthBounds,
  getISTDateKey,
  getISTWeekday,
  getNextSundayIST,
}
