import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, X } from 'lucide-react'
import { formatPrice } from '../format'
import type { Recommendation } from '../types'

const LISBON_DEMO_POINTS = [
  { name: 'Rossio Square', address: 'Praça do Rossio, 1100-200 Lisboa', latitude: 38.7139, longitude: -9.1394 },
  { name: 'Praça da Figueira', address: 'Praça da Figueira, 1100-240 Lisboa', latitude: 38.7130, longitude: -9.1378 },
  { name: 'Praça do Comércio', address: 'Praça do Comércio, 1100-148 Lisboa', latitude: 38.7075, longitude: -9.1365 },
  { name: 'Luís de Camões Square', address: 'Largo Luís de Camões, 1200-243 Lisboa', latitude: 38.7106, longitude: -9.1431 },
  { name: 'Martim Moniz Square', address: 'Praça Martim Moniz, 1100-341 Lisboa', latitude: 38.7168, longitude: -9.1369 },
  { name: 'São Pedro de Alcântara', address: 'R. de São Pedro de Alcântara, 1250-238 Lisboa', latitude: 38.7152, longitude: -9.1448 },
  { name: 'Time Out Market', address: 'Av. 24 de Julho, 1200-479 Lisboa', latitude: 38.7068, longitude: -9.1456 },
  { name: 'Largo do Carmo', address: 'Largo do Carmo, 1200-092 Lisboa', latitude: 38.7120, longitude: -9.1408 },
  { name: 'Restauradores Square', address: 'Praça dos Restauradores, 1250-187 Lisboa', latitude: 38.7158, longitude: -9.1416 },
  { name: 'Lisbon Cathedral', address: 'Largo da Sé, 1100-585 Lisboa', latitude: 38.7098, longitude: -9.1331 },
]

export function RecommendationMap({
  items,
  onClose,
}: {
  items: Recommendation[]
  onClose: () => void
}) {
  const destination = items[0]?.destination ?? 'Your destination'
  const [selected, setSelected] = useState(items[0]?.productCode ?? null)
  const mapElement = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const located = useMemo(() => items.map((item, index) => ({
    item,
    meetingPoint: item.meetingPoint ?? LISBON_DEMO_POINTS[index % LISBON_DEMO_POINTS.length],
    demo: !item.meetingPoint || item.meetingPoint.isDemo,
  })), [items])
  const hasDemoLocations = located.some(({ demo }) => demo)

  useEffect(() => {
    if (!mapElement.current || located.length === 0) return
    const map = L.map(mapElement.current, { zoomControl: true, scrollWheelZoom: true })
    mapInstance.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    const bounds = L.latLngBounds([])
    located.forEach(({ item, meetingPoint }, index) => {
      const position: L.LatLngExpression = [meetingPoint.latitude, meetingPoint.longitude]
      bounds.extend(position)
      const marker = L.marker(position, {
        icon: L.divIcon({
          className: 'roadio-map-marker',
          html: `<span>${index + 1}</span><strong>${formatPrice(item.fromPrice)}</strong>`,
          iconSize: [64, 30],
          iconAnchor: [32, 15],
        }),
      }).addTo(map)
      marker.bindPopup(`<strong>${item.title}</strong><br>${meetingPoint.address}`)
      marker.on('click', () => setSelected(item.productCode))
    })
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 15 })
    window.setTimeout(() => map.invalidateSize(), 0)

    return () => {
      mapInstance.current = null
      map.remove()
    }
  }, [located])

  const selectItem = (productCode: string, index: number) => {
    setSelected(productCode)
    const meetingPoint = located[index]?.meetingPoint
    if (meetingPoint) mapInstance.current?.flyTo([meetingPoint.latitude, meetingPoint.longitude], 16)
  }

  return (
    <section className="map-sheet inline-map" aria-label={`Picks near ${destination}`}>
        <header className="map-sheet-header">
          <div>
            <span className="map-eyebrow"><MapPin /> {hasDemoLocations ? 'Demo meeting points' : 'Meeting points'}</span>
            <h3>{destination}</h3>
          </div>
          <button onClick={onClose} aria-label="Close map"><X /></button>
        </header>
        <div className="quick-map" ref={mapElement} />
        <div className="map-pick-list">
          {items.slice(0, 10).map((item, index) => (
            <button
              className={selected === item.productCode ? 'selected' : ''}
              key={item.productCode}
              onClick={() => selectItem(item.productCode, index)}
            >
              <span>{index + 1}</span>
              <strong>{item.title}</strong>
              <small>
                {item.meetingPoint
                  ? `${item.meetingPoint.isDemo && !item.meetingPoint.address.startsWith('Demo ·') ? 'Demo · ' : ''}${item.meetingPoint.address}`
                  : `Demo · ${LISBON_DEMO_POINTS[index % LISBON_DEMO_POINTS.length].address}`}
              </small>
            </button>
          ))}
        </div>
    </section>
  )
}
