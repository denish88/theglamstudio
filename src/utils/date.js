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

module.exports = { getISTDayBounds, getISTMonthBounds }
