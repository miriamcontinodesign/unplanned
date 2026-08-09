import { useState } from 'react'
import { ArrowRight, CheckCircle2, Clock, Sparkles, Star } from 'lucide-react'
import { categoryFor, glyphFor, gradientFor } from './ActivityArt'
import { formatDuration, formatPrice } from '../format'
import type { Recommendation } from '../types'

export function RecommendationCard({
  item,
  tripDays,
  status,
  onAccept,
  onPass,
}: {
  item: Recommendation
  tripDays: number
  status: 'added' | 'passed' | undefined
  onAccept: (day: number) => void
  onPass: () => void
}) {
  const [day, setDay] = useState(item.suggestedDay)

  // Passed items are dropped for good - the recommender never resurfaces them,
  // so there is nothing useful left to show in the carousel.
  if (status === 'passed') return null

  const badge = item.rating
    ? `★ ${item.rating}`
    : item.freeCancellation
      ? 'Free cancel'
      : (formatDuration(item.durationMinutes) ?? 'Sample pick')

  return (
    <div className={`rec-card${status === 'added' ? ' is-added' : ''}`}>
      <div
        className={`rec-banner${item.imageUrl ? ' has-photo' : ''}`}
        style={item.imageUrl
          ? { backgroundImage: `linear-gradient(180deg, rgba(20, 15, 12, .08), rgba(20, 15, 12, .34)), url("${item.imageUrl}")` }
          : { background: gradientFor(item.productCode) }}
      >
        <div className="rec-banner-top">
          <span className="rec-pill category">{categoryFor(item.tags)}</span>
          <span className="rec-pill badge">{badge}</span>
        </div>
        <div className="rec-banner-bottom">
          <span className="rec-glyph">{glyphFor(item.tags)}</span>
          <span className="rec-price-chip">{formatPrice(item.fromPrice)}</span>
        </div>
      </div>

      <div className="rec-body">
        <h4 className="rec-title">{item.title}</h4>
        <p className="rec-summary">{item.summary}</p>

        <div className="rec-reason">
          <Sparkles />
          <span>{item.reason}</span>
        </div>

        <div className="rec-meta">
          <span className="rec-dist">
            {item.rating ? <Star /> : <Clock />}
            {item.rating
              ? `${item.rating}${item.reviewCount ? ` (${item.reviewCount.toLocaleString()})` : ''}`
              : (formatDuration(item.durationMinutes) ?? 'Flexible timing')}
          </span>
          <span className="rec-price">{formatPrice(item.fromPrice)}</span>
        </div>

        {status === 'added' ? (
          <div className="rec-added">
            <CheckCircle2 />
            <span>Added to Day {day}</span>
          </div>
        ) : (
          <div className="rec-actions">
            <div className="rec-actions-row">
              <select
                className="day-picker"
                value={day}
                onChange={(event) => setDay(Number(event.target.value))}
                aria-label={`Day for ${item.title}`}
              >
                {Array.from({ length: Math.max(tripDays, 1) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Day {n}
                  </option>
                ))}
              </select>
              <button className="btn-pass" onClick={onPass}>
                Pass
              </button>
            </div>
            <button className="btn-accept" onClick={() => onAccept(day)}>
              <span>Add to itinerary</span>
              <ArrowRight />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
