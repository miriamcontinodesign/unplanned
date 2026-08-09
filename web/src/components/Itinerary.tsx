import { ActivityArt } from './ActivityArt'
import { formatDuration } from '../format'
import type { ItineraryDay, Preference, Trip } from '../types'

export function Itinerary({
  itinerary,
  trip,
  preferences,
  onRemove,
}: {
  itinerary: ItineraryDay[]
  trip: Trip | null
  preferences: Preference[]
  onRemove: (id: number) => void
}) {
  const planned = itinerary.reduce((total, day) => total + day.items.length, 0)

  const spend = itinerary
    .flatMap((day) => day.items)
    .reduce((total, item) => total + (item.priceAmount ?? 0), 0)

  if (!trip) {
    return (
      <div className="empty">
        <h3>No trip yet</h3>
        <p>Tell me where you're going and your itinerary will build itself here.</p>
      </div>
    )
  }

  return (
    <>
      <div className="summary-bar">
        <div>
          <dt>Destination</dt>
          <dd>{trip.label}</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>{trip.days ? `${trip.days} days` : '-'}</dd>
        </div>
        <div>
          <dt>Planned</dt>
          <dd>{planned}</dd>
        </div>
        {spend > 0 && (
          <div>
            <dt>Est. spend</dt>
            <dd>${Math.round(spend)}</dd>
          </div>
        )}
      </div>

      {preferences.length > 0 && (
        <div className="prefs">
          {preferences.map((pref) => (
            <span className="pref" key={pref.id}>
              {pref.kind === 'dislike' ? 'avoids ' : ''}
              {pref.text}
            </span>
          ))}
        </div>
      )}

      {planned === 0 && (
        <div className="notice">
          <span>◆</span>
          <span>Nothing added yet. Accept a suggestion in the chat and it lands on a day here.</span>
        </div>
      )}

      {itinerary.map((day) => (
        <div className={`day ${day.items.length > 0 ? 'filled' : ''}`} key={day.day}>
          <div className="day-marker" />
          <div className="day-label">Day {day.day}</div>

          {day.items.length === 0 ? (
            <div className="day-empty">Nothing planned</div>
          ) : (
            day.items.map((item) => (
              <div className="itinerary-item" key={item.id}>
                <ActivityArt seed={item.productCode ?? item.title} tags={[]} />
                <div>
                  <h4>{item.title}</h4>
                  <p>
                    {[formatDuration(item.durationMinutes), item.priceAmount ? `$${item.priceAmount}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  className="btn-remove"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove ${item.title}`}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      ))}
    </>
  )
}
