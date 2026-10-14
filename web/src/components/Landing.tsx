import { useRef, useState } from 'react'
import { Landmark, MapPin, Martini, PenLine, ShoppingBag, Utensils, X } from 'lucide-react'
import { CitySearch } from './CitySearch'
import { LocateButton } from './LocateButton'
import type { DetectedPlace } from '../geolocate'

// Starting points for "what are you up to". Picking one fills the field with a natural
// sentence the traveler can still edit before submitting.
const CATEGORIES = [
  { label: 'Food & drink', Icon: Utensils, text: 'Something fun with food and drink' },
  { label: 'Shopping', Icon: ShoppingBag, text: 'Some good shopping' },
  { label: 'Culture & sights', Icon: Landmark, text: 'Culture and sights worth seeing' },
  { label: 'Nightlife', Icon: Martini, text: 'A fun night out' },
] as const

export function Landing({
  greeting,
  busy,
  error,
  tripLabel,
  onSend,
  onLocate,
}: {
  greeting: string
  busy: boolean
  error: string | null
  /** Where the traveler already is on the server, if they picked a place before reloading. */
  tripLabel: string | null
  onSend: (text: string) => void
  onLocate: (place: DetectedPlace) => Promise<{ ok: true } | { ok: false; message: string }>
}) {
  const [draft, setDraft] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [placeLabel, setPlaceLabel] = useState<string | null>(tripLabel)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const message = draft.trim()
  const canSubmit = Boolean(placeLabel) && message.length > 0 && !busy

  const submit = () => {
    if (!canSubmit) return
    onSend(message)
    setDraft('')
  }

  // Choosing a place only resolves the destination in the background - it is not a
  // message on the traveler's behalf.
  const handlePlace = async (place: DetectedPlace) => {
    const result = await onLocate(place)
    if (result.ok) {
      setPlaceLabel(place.label)
      setNote(null)
    } else {
      setNote(result.message)
    }
    inputRef.current?.focus()
  }

  const handleFailed = (message: string) => setNote(message)

  const pickCategory = (item: (typeof CATEGORIES)[number]) => {
    const selected = category === item.label
    setCategory(selected ? null : item.label)
    setDraft(selected ? '' : item.text)
    inputRef.current?.focus()
  }

  const hint = busy
    ? null
    : !placeLabel
      ? 'Choose where you are to continue.'
      : !message
        ? 'Pick a category or tell me what you’re up to.'
        : null

  return (
    <div className="landing">
      <div className="landing-blob a" />
      <div className="landing-blob b" />

      <div className="landing-hero">
        <div className="landing-brand" style={{ viewTransitionName: 'roadio-brand' }}>
          <div className="landing-brand-icon">
            <img src="/logo.png" alt="" />
          </div>
          <span className="landing-wordmark">Unplanned</span>
        </div>

        <p className="landing-greeting">{greeting}</p>

        {note && <p className="landing-note error">{note}</p>}
        {error && <p className="landing-note error">{error}</p>}

        <form
          className="landing-form"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <section className="landing-section">
            <h2 className="landing-label">Where are you?</h2>
            {placeLabel ? (
              <div className="landing-place">
                <MapPin />
                <span>{placeLabel}</span>
                <button
                  type="button"
                  onClick={() => setPlaceLabel(null)}
                  disabled={busy}
                  aria-label="Change location"
                  title="Change location"
                >
                  <X />
                </button>
              </div>
            ) : (
              <>
                <LocateButton onDetected={handlePlace} onFailure={handleFailed} disabled={busy} />
                <CitySearch onSelect={handlePlace} disabled={busy} />
              </>
            )}
          </section>

          <section className="landing-section" style={{ viewTransitionName: 'composer' }}>
            <h2 className="landing-label">What are you up to?</h2>
            <div className="landing-categories">
              {CATEGORIES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={`landing-chip${category === item.label ? ' is-selected' : ''}`}
                  onClick={() => pickCategory(item)}
                  disabled={busy}
                >
                  <item.Icon />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="landing-field">
              <PenLine />
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setCategory(null)
                }}
                placeholder="Or type what you're in the mood for…"
                aria-label="Message"
              />
            </div>
          </section>

          <button type="submit" className="landing-submit" disabled={!canSubmit}>
            {busy ? 'Finding ideas…' : 'Find things to do'}
          </button>
          {hint && <p className="landing-hint">{hint}</p>}
        </form>
      </div>
    </div>
  )
}
