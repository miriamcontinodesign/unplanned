export function formatDuration(minutes: number | null): string | null {
  if (!minutes) return null
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours}h` : `${Math.floor(hours)}h ${minutes % 60}m`
}

export function formatPrice(price: { amount: number; currency: string }): string {
  return `${price.currency === 'USD' ? '$' : ''}${price.amount}`
}

export function formatTime(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
