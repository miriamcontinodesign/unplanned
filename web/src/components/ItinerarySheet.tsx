import { useEffect, useState } from 'react'
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
  onReset,
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
  onReset: () => Promise<void>
  linked: boolean
  linkCode: string | null
  onGetLinkCode: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Never leave the sheet armed: reopening it should not be one tap away from
  // discarding the trip.
  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

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

          <div className="reset-zone">
            {confirming ? (
              <>
                <p className="reset-warning">
                  This clears the itinerary, everything Roadio has learned about you, and the
                  chat. Any bookings you've made are kept.
                </p>
                <div className="reset-actions">
                  <button
                    className="btn-danger"
                    disabled={resetting}
                    onClick={async () => {
                      setResetting(true)
                      try {
                        await onReset()
                      } finally {
                        setResetting(false)
                        setConfirming(false)
                      }
                    }}
                  >
                    {resetting ? 'Starting over...' : 'Yes, start over'}
                  </button>
                  <button className="btn-quiet" disabled={resetting} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="btn-quiet" onClick={() => setConfirming(true)}>
                Start a new trip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
