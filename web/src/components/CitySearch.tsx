import { useEffect, useRef, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import type { DetectedPlace } from '../geolocate'

interface Suggestion {
  place: DetectedPlace
  detail: string
}

function suggestion(city: string, country: string | null, countryCode: string | null, region: string | null, latitude: number, longitude: number): Suggestion {
  return {
    place: { city, country, countryCode, region, latitude, longitude, label: [city, country].filter(Boolean).join(', ') },
    detail: [region && region !== city ? region : null, country].filter(Boolean).join(', '),
  }
}

// Shown before the traveler types anything: cities with good Viator coverage.
const POPULAR: Suggestion[] = [
  suggestion('Lisbon', 'Portugal', 'PT', null, 38.7223, -9.1393),
  suggestion('Porto', 'Portugal', 'PT', null, 41.1579, -8.6291),
  suggestion('Madrid', 'Spain', 'ES', null, 40.4168, -3.7038),
  suggestion('Barcelona', 'Spain', 'ES', null, 41.3874, 2.1686),
  suggestion('Paris', 'France', 'FR', null, 48.8566, 2.3522),
  suggestion('Rome', 'Italy', 'IT', null, 41.9028, 12.4964),
  suggestion('London', 'United Kingdom', 'GB', null, 51.5072, -0.1276),
  suggestion('New York', 'United States', 'US', null, 40.7128, -74.006),
  suggestion('Mexico City', 'Mexico', 'MX', null, 19.4326, -99.1332),
  suggestion('Rio de Janeiro', 'Brazil', 'BR', null, -22.9068, -43.1729),
  suggestion('Tokyo', 'Japan', 'JP', null, 35.6762, 139.6503),
  suggestion('Bangkok', 'Thailand', 'TH', null, 13.7563, 100.5018),
  suggestion('Sydney', 'Australia', 'AU', null, -33.8688, 151.2093),
  suggestion('Cape Town', 'South Africa', 'ZA', null, -33.9249, 18.4241),
]

interface GeocodeResult {
  name: string
  latitude: number
  longitude: number
  country?: string
  country_code?: string
  admin1?: string
  feature_code?: string
}

/** Open-Meteo's geocoder: free, keyless and CORS-enabled, and the same one the server uses. */
async function searchCities(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.search = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' }).toString()
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Geocoding failed (${response.status})`)
  const data = (await response.json()) as { results?: GeocodeResult[] }
  return (data.results ?? [])
    .filter((result) => !result.feature_code || result.feature_code.startsWith('PPL'))
    .map((r) => suggestion(r.name, r.country ?? null, r.country_code ?? null, r.admin1 ?? null, r.latitude, r.longitude))
    .filter((option, index, all) => all.findIndex((other) => other.place.city === option.place.city && other.detail === option.detail) === index)
}

/** Type-ahead city picker, for travelers who would rather not share their location. */
export function CitySearch({
  onSelect,
  disabled,
}: {
  onSelect: (place: DetectedPlace) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Suggestion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [opensUp, setOpensUp] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const query = text.trim()
  const options = query.length >= 2 ? (results ?? []) : POPULAR

  useEffect(() => {
    if (query.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      searchCities(query, controller.signal)
        .then((found) => {
          setResults(found)
          setActive(0)
          setLoading(false)
        })
        .catch((error: Error) => {
          if (error.name === 'AbortError') return
          setResults([])
          setLoading(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Open upward when the list would not fit below the field (short windows, landscape phones).
  useEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    setOpensUp(window.innerHeight - rect.bottom < 250 && rect.top > window.innerHeight - rect.bottom)
  }, [open])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = (option: Suggestion) => {
    setText('')
    setOpen(false)
    onSelect(option.place)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      const option = options[active]
      if (open && option) {
        event.preventDefault()
        choose(option)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const showEmpty = query.length >= 2 && !loading && options.length === 0

  return (
    <div className="city-search" ref={rootRef}>
      <div className="city-search-field">
        <Search />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="city-search-list"
          aria-label="Search for a city"
          placeholder="Or search for a city"
          autoComplete="off"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && !disabled && (
        <ul className={`city-search-list${opensUp ? ' opens-up' : ''}`} id="city-search-list" role="listbox">
          {query.length < 2 && <li className="city-search-heading">Popular cities</li>}
          {loading && <li className="city-search-status">Searching…</li>}
          {showEmpty && <li className="city-search-status">No cities found</li>}
          {!loading &&
            options.map((option, index) => (
              <li
                key={`${option.place.city}-${option.place.latitude}`}
                role="option"
                aria-selected={index === active}
                className={`city-search-option${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(option)
                }}
              >
                <MapPin />
                <span className="city-search-name">{option.place.city}</span>
                <span className="city-search-detail">{option.detail}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
