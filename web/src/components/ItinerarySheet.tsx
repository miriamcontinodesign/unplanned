import { X } from 'lucide-react'
import { Itinerary } from './Itinerary'
import type { ItineraryDay, Preference, Trip } from '../types'

export function ItinerarySheet({
  open,
  onClose,
  itinerary,
  trip,
  preferences,
  onRemove,
  linked,
  linkCode,
  onGetLinkCode,
}: {
  open: boolean
  onClose: () => void
  itinerary: ItineraryDay[]
  trip: Trip | null
  preferences: Preference[]
  onRemove: (id: number) => void
  linked: boolean
  linkCode: string | null
  onGetLinkCode: () => void
}) {
  if (!open) return null

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h3>Trip plan</h3>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="sheet-body">
          <Itinerary itinerary={itinerary} trip={trip} preferences={preferences} onRemove={onRemove} />

          {trip && !linked && (
            <div className="link-card">
              <h4>Take this with you</h4>
              <p>
                Link Telegram and the same memory follows you on the road - ask anything, and it speaks
                up when something's worth doing.
              </p>
              {linkCode ? (
                <div className="link-code">{linkCode}</div>
              ) : (
                <button className="btn-secondary" onClick={onGetLinkCode}>
                  Get link code
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
