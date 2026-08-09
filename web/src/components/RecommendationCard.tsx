import { useState } from 'react'
import { ArrowRight, CheckCircle2, Clock, PhoneCall, Star } from 'lucide-react'
import { categoryFor, glyphFor, gradientFor } from './ActivityArt'
import { formatDuration, formatPrice } from '../format'
import type { Recommendation } from '../types'

export function RecommendationCard({
  item,
  status,
  onAccept,
  onCall,
  onPass,
}: {
  item: Recommendation
  status: 'added' | 'passed' | undefined
  onAccept: () => void
  onCall: () => Promise<'handed_off'>
  onPass: () => void
}) {
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'handed_off' | 'unavailable'>('idle')

  const callToBook = async () => {
    if (callStatus === 'calling' || callStatus === 'handed_off') return
    setCallStatus('calling')
    try {
      setCallStatus(await onCall())
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
            <span>Added ✓</span>
          </div>
        ) : (
          <div className="rec-actions">
            <button className="btn-pass" onClick={onPass}>
              Pass
            </button>
            <button className="btn-accept" onClick={onAccept}>
              <span>Add</span>
              <ArrowRight />
            </button>
            <button
              className={`btn-call is-${callStatus}`}
              onClick={() => void callToBook()}
              disabled={callStatus === 'calling' || callStatus === 'handed_off'}
            >
              <PhoneCall />
              <span>
                {callStatus === 'calling' && 'Opening…'}
                {callStatus === 'handed_off' && 'Opened in Concierge Line'}
                {callStatus === 'unavailable' && 'Concierge unavailable — try again'}
                {callStatus === 'idle' && 'Book'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
