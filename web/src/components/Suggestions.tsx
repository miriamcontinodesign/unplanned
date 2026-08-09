import { useState } from 'react'
import { ActivityArt } from './ActivityArt'
import type { Recommendation } from '../types'

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  if (Number.isInteger(hours)) return `${hours}h`
  return `${Math.floor(hours)}h ${minutes % 60}m`
}

export function Suggestions({
  recommendations,
  tripDays,
  sampleData,
  loading,
  onAccept,
  onPass,
}: {
  recommendations: Recommendation[]
  tripDays: number
  sampleData: boolean
  loading: boolean
  onAccept: (productCode: string, day: number) => void
  onPass: (productCode: string) => void
}) {
  const [days, setDays] = useState<Record<string, number>>({})

  if (loading) {
    return (
      <div className="empty">
        <h3>Finding things worth doing</h3>
        <p>One moment.</p>
      </div>
    )
  }

  if (recommendations.length === 0) {
    return (
      <div className="empty">
        <h3>Nothing left to suggest</h3>
        <p>You've been through everything on offer here. Tell me more about what you like and I'll dig deeper.</p>
      </div>
    )
  }

  return (
    <>
      {sampleData && (
        <div className="notice">
          <span>◆</span>
          <span>
            Sample inventory - realistic but not bookable. A real supplier drops in behind the same
            interface.
          </span>
        </div>
      )}

      {recommendations.map((item) => {
        const day = days[item.productCode] ?? item.suggestedDay

        return (
          <article className="card" key={item.productCode}>
            <ActivityArt seed={item.productCode} tags={item.tags} />

            <div>
              <h3 className="card-title">{item.title}</h3>

              <div className="card-meta">
                <span className="price">
                  {item.fromPrice.currency === 'USD' ? '$' : ''}
                  {item.fromPrice.amount}
                </span>
                <span>{duration(item.durationMinutes)}</span>
                {item.rating && (
                  <span>
                    ★ {item.rating}
                    {item.reviewCount ? ` (${item.reviewCount.toLocaleString()})` : ''}
                  </span>
                )}
                {item.freeCancellation && <span>Free cancellation</span>}
              </div>

              <div className="card-reason">{item.reason}</div>
              <p className="card-summary">{item.summary}</p>

              <div className="card-actions">
                <button className="btn-accept" onClick={() => onAccept(item.productCode, day)}>
                  Add to itinerary
                </button>

                <select
                  className="day-picker"
                  value={day}
                  onChange={(event) =>
                    setDays((prev) => ({
                      ...prev,
                      [item.productCode]: Number(event.target.value),
                    }))
                  }
                  aria-label={`Day for ${item.title}`}
                >
                  {Array.from({ length: Math.max(tripDays, 1) }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Day {n}
                    </option>
                  ))}
                </select>

                <button className="btn-pass" onClick={() => onPass(item.productCode)}>
                  Not for me
                </button>
              </div>
            </div>
          </article>
        )
      })}
    </>
  )
}
