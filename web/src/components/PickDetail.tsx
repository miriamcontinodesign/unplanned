import { useEffect, useState } from 'react'
import { ArrowLeft, Clock, ExternalLink, ShieldCheck, Star } from 'lucide-react'
import { ActivityArt } from './ActivityArt'
import { api } from '../api'
import { formatDuration, formatPrice } from '../format'
import type { PickDetailData } from '../types'

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Full page for one saved pick, opened from My picks. */
export function PickDetail({
  id,
  onBack,
  onRemove,
}: {
  id: number
  onBack: () => void
  onRemove: (id: number) => void
}) {
  const [data, setData] = useState<PickDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api
      .pick(id)
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [id])

  const { pick, activity } = data ?? {}
  const price = pick?.priceAmount
    ? formatPrice({ amount: pick.priceAmount, currency: pick.currency ?? 'USD' })
    : activity?.fromPrice.amount
      ? formatPrice(activity.fromPrice)
      : null
  const duration = formatDuration(pick?.durationMinutes ?? activity?.durationMinutes ?? null)
  const about = pick?.detail || activity?.summary

  return (
    <div className="pane">
      <div className="detail-bar">
        <button className="detail-back" onClick={onBack} aria-label="Back to My picks" title="Back to My picks">
          <ArrowLeft />
        </button>
        <span className="detail-bar-title">My picks</span>
      </div>

      <div className="picks-scroll">
        {error && (
          <div className="empty">
            <h3>Couldn't open this pick</h3>
            <p>{error}</p>
          </div>
        )}

        {!error && !data && (
          <div className="empty">
            <h3>Loading</h3>
          </div>
        )}

        {pick && (
          <article className="detail">
            <div
              className={`detail-hero${activity?.imageUrl ? ' has-photo' : ''}`}
              style={activity?.imageUrl ? { backgroundImage: `url("${activity.imageUrl}")` } : undefined}
            >
              {!activity?.imageUrl && (
                <ActivityArt seed={pick.productCode ?? pick.title} tags={activity?.tags ?? []} className="detail-art" />
              )}
            </div>

            {(activity?.category || pick.atTime) && (
              <div className="detail-pills">
                {activity?.category && <span className="detail-pill">{activity.category}</span>}
                {pick.atTime && <span className="detail-pill is-time">{capitalize(pick.atTime)}</span>}
              </div>
            )}

            <h2 className="detail-title">{pick.title}</h2>

            <div className="detail-facts">
              {activity?.rating ? (
                <span>
                  <Star />
                  {activity.rating.toFixed(1)}
                  {activity.reviewCount ? ` (${activity.reviewCount.toLocaleString()})` : ''}
                </span>
              ) : null}
              {duration && (
                <span>
                  <Clock />
                  {duration}
                </span>
              )}
              {activity?.freeCancellation && (
                <span>
                  <ShieldCheck />
                  Free cancellation
                </span>
              )}
            </div>

            {price && (
              <p className="detail-price">
                <strong>{price}</strong> <span>per person, starting price</span>
              </p>
            )}

            {about && <p className="detail-about">{about}</p>}

            {!activity && (
              <p className="detail-note">Live details for this experience aren't available right now.</p>
            )}

            <div className="detail-actions">
              {activity?.productUrl && (
                <a className="detail-link" href={activity.productUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  View on Viator
                </a>
              )}
              <button className="detail-remove" onClick={() => onRemove(pick.id)}>
                Remove from my picks
              </button>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
