import { useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Composer } from './Composer'
import { LocateButton } from './LocateButton'
import type { DetectedPlace } from '../geolocate'

export function Landing({
  greeting,
  busy,
  error,
  onSend,
  onReset,
  onLocate,
}: {
  greeting: string
  busy: boolean
  error: string | null
  onSend: (text: string) => void
  onReset: () => void
  onLocate: (place: DetectedPlace) => Promise<{ ok: true } | { ok: false; message: string }>
}) {
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed)
    setDraft('')
  }

  // Detecting a location only resolves the destination in the background -
  // it is not a message on the traveler's behalf. They still type their own
  // first message, right here, to say what they're actually up to.
  const handleDetected = async (place: DetectedPlace) => {
    const result = await onLocate(place)
    setNote(result.ok ? `You're in ${place.city}. What are you up to?` : result.message)
    inputRef.current?.focus()
  }

  const handleFailed = (message: string) => {
    setNote(message)
    inputRef.current?.focus()
  }

  return (
    <div className="landing">
      <div className="landing-blob a" />
      <div className="landing-blob b" />

      <button className="masthead-reset landing-reset" onClick={onReset} title="Reset demo" aria-label="Reset">
        <RefreshCw />
      </button>

      <div className="landing-hero">
        <div className="landing-brand" style={{ viewTransitionName: 'roadio-brand' }}>
          <div className="landing-brand-icon">
            <img src="/logo.png" alt="" />
          </div>
          <span className="landing-wordmark">Unplanned</span>
        </div>

        <p className="landing-greeting">{greeting}</p>

        {note && <p className="landing-note">{note}</p>}
        {error && <p className="landing-note error">{error}</p>}

        <div className="landing-composer">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => submit(draft)}
            placeholder="What are you up to?"
            busy={busy}
            inputRef={inputRef}
            morph
          />
        </div>

        <LocateButton onDetected={handleDetected} onFailure={handleFailed} disabled={busy} />
      </div>
    </div>
  )
}
