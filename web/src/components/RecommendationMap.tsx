import { MapPin, X } from 'lucide-react'
import { formatPrice } from '../format'
import type { Recommendation } from '../types'

function position(code: string, offset: number) {
  let hash = offset * 977
  for (const char of code) hash = Math.imul(hash ^ char.charCodeAt(0), 31)
  return {
    left: 14 + (Math.abs(hash) % 70),
    top: 18 + (Math.abs(Math.floor(hash / 83)) % 58),
  }
}

export function RecommendationMap({
  items,
  onClose,
}: {
  items: Recommendation[]
  onClose: () => void
}) {
  const destination = items[0]?.destination ?? 'Your destination'

  return (
    <section className="map-sheet inline-map" aria-label={`Picks near ${destination}`}>
        <header className="map-sheet-header">
          <div>
            <span className="map-eyebrow"><MapPin /> Nearby picks</span>
            <h3>{destination}</h3>
          </div>
          <button onClick={onClose} aria-label="Close map"><X /></button>
        </header>
        <div className="quick-map">
          <div className="quick-map-grid" />
          <span className="quick-map-place">{destination}</span>
          {items.map((item, index) => {
            const point = position(item.productCode, index)
            return (
              <button
                className="quick-map-pin"
                key={item.productCode}
                style={{ left: `${point.left}%`, top: `${point.top}%` }}
                title={item.title}
              >
                <span>{index + 1}</span>
                {formatPrice(item.fromPrice)}
              </button>
            )
          })}
        </div>
        <div className="map-pick-list">
          {items.slice(0, 5).map((item, index) => (
            <div key={item.productCode}>
              <span>{index + 1}</span>
              <strong>{item.title}</strong>
              <small>{formatPrice(item.fromPrice)}</small>
            </div>
          ))}
        </div>
    </section>
  )
}
