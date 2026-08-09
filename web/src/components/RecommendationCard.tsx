import { useState } from 'react'
import { ArrowRight, CheckCircle2, Clock, PhoneCall, Star } from 'lucide-react'
import { categoryFor, glyphFor, gradientFor } from './ActivityArt'
import { formatDuration, formatPrice } from '../format'
import type { Recommendation } from '../types'

export function RecommendationCard({
  item,
  tripDays,
  status,
  onAccept,
  onCall,
  onPass,
}: {
  item: Recommendation
  tripDays: number
  status: 'added' | 'passed' | undefined
  onAccept: (day: number) => void
  onCall: (day: number) => Promise<'confirmed' | 'not_confirmed'>
  onPass: () => void
}) {
  const [day, setDay] = useState(item.suggestedDay)
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'confirmed' | 'not_confirmed' | 'unavailable'>('idle')

  const callToBook = async () => {
    if (callStatus === 'calling' || callStatus === 'confirmed') return
    setCallStatus('calling')
    try {
      setCallStatus(await onCall(day))
    } catch {
      setCallStatus('unavailable')
    }
  }

  // Passed items are dropped for good - the recommender never resurfaces them,
  // so there is nothing useful left to show in the carousel.
  if (status === 'passed') return null

  const rating = item.rating?.toFixed(1)
  const badge = rating
    ? `★ ${rating}`
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
          <span className="rec-pill category">{item.category || categoryFor(item.tags)}</span>
          <span className="rec-pill badge">{badge}</span>
        </div>
        <div className="rec-banner-bottom">
          {!item.imageUrl && <span className="rec-glyph">{glyphFor(item.tags)}</span>}
          <span className="rec-price-chip">{formatPrice(item.fromPrice)}</span>
        </div>
      </div>

      <div className="rec-body">
        <h4 className="rec-title">{item.title}</h4>

        <div className="rec-reason">
          <span>{item.reason}</span>
        </div>

        <div className="rec-meta">
          <span className="rec-dist">
            {item.rating ? <Star /> : <Clock />}
            {item.rating
              ? `${rating}${item.reviewCount ? ` (${item.reviewCount.toLocaleString()})` : ''}`
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
            <button
              className={`btn-call is-${callStatus}`}
              onClick={() => void callToBook()}
              disabled={callStatus === 'calling' || callStatus === 'confirmed'}
            >
              <PhoneCall />
              <span>
                {callStatus === 'calling' && 'Calling…'}
                {callStatus === 'confirmed' && 'Booking confirmed'}
                {callStatus === 'not_confirmed' && 'Not booked — try again'}
                {callStatus === 'unavailable' && 'Calling unavailable — try again'}
                {callStatus === 'idle' && 'Book'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
