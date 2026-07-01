function getISTDayBounds(date = new Date()) {
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

  return {
    start: new Date(`${y}-${m}-${d}T00:00:00+05:30`),
    end: new Date(`${y}-${m}-${d}T23:59:59.999+05:30`),
  }
}

module.exports = { getISTDayBounds }
