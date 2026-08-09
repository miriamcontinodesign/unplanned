import { ChevronUp, Map } from 'lucide-react'

export function ItineraryStrip({
  plannedCount,
  tripDays,
  onOpen,
}: {
  plannedCount: number
  tripDays: number
  onOpen: () => void
}) {
  return (
    <button className="itinerary-strip" onClick={onOpen}>
      <span className="strip-icon">
        <Map />
      </span>
      <span className="strip-text">
        {plannedCount > 0 ? `${plannedCount} planned` : 'Trip plan'}
        <span>
          {tripDays} day{tripDays === 1 ? '' : 's'} · tap to review
        </span>
      </span>
      <ChevronUp className="chevron" />
    </button>
  )
}
