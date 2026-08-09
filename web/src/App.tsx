import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, MapPin } from 'lucide-react'
import { api } from './api'
import { Chat } from './components/Chat'
import { ItinerarySheet } from './components/ItinerarySheet'
import { ItineraryStrip } from './components/ItineraryStrip'
import type { Recommendation, Snapshot } from './types'

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [carousels, setCarousels] = useState<Record<number, Recommendation[]>>({})
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null)
  const [sampleData, setSampleData] = useState(false)
  const [cardStatus, setCardStatus] = useState<Record<string, 'added' | 'passed'>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkCode, setLinkCode] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // Recommendations aren't a separate view any more - each batch is pinned to
  // the assistant turn that was current when it was fetched, so it renders as
  // a carousel under that message instead of a global, ever-shifting list.
  const refreshRecommendations = useCallback(async (attachIndex: number) => {
    setLoadingIndex(attachIndex)
    try {
      const result = await api.recommendations()
      setCarousels((prev) => ({ ...prev, [attachIndex]: result.recommendations }))
      setSampleData(Boolean(result.sampleData))
    } catch {
      // A failed refresh shouldn't blow away what's already on screen.
    } finally {
      setLoadingIndex((current) => (current === attachIndex ? null : current))
    }
  }, [])

  useEffect(() => {
    api
      .me()
      .then((state) => {
        setSnapshot(state)
        if (state.phase === 'ready' && state.messages.length > 0) {
          void refreshRecommendations(state.messages.length - 1)
        }
      })
      .catch((err: Error) => setError(err.message))
  }, [refreshRecommendations])

  const showToast = (text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  const send = async (text: string) => {
    setBusy(true)
    setError(null)
    try {
      const next = await api.chat(text)
      setSnapshot(next)
      if (next.phase === 'ready' && next.messages.length > 0) {
        void refreshRecommendations(next.messages.length - 1)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const accept = async (productCode: string, day: number) => {
    try {
      setSnapshot(await api.accept(productCode, day))
      setCardStatus((prev) => ({ ...prev, [productCode]: 'added' }))
      showToast(`Added to Day ${day}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const pass = async (productCode: string) => {
    try {
      setSnapshot(await api.pass(productCode))
      setCardStatus((prev) => ({ ...prev, [productCode]: 'passed' }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const remove = async (id: number) => {
    try {
      setSnapshot(await api.remove(id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const getLinkCode = async () => {
    try {
      const result = await api.linkCode()
      setLinkCode(result.code)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!snapshot) {
    return (
      <div className="app-shell">
        <div className="empty" style={{ paddingTop: '30vh' }}>
          <h3>{error ? 'Could not reach the server' : 'Loading'}</h3>
          {error && <p>{error}</p>}
        </div>
      </div>
    )
  }

  const plannedCount = snapshot.itinerary.reduce((total, day) => total + day.items.length, 0)
  const tripDays = snapshot.trip?.days ?? 3

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="masthead-avatar">
          <MapPin />
        </div>
        <div className="masthead-titles">
          <div className="masthead-title-row">
            <span className="wordmark">roadio</span>
            {snapshot.trip && <span className="trip-badge">{snapshot.trip.city}</span>}
          </div>
          <div className="masthead-sub">
            <span className="pulse-dot" />
            <span>{snapshot.trip ? snapshot.trip.label : 'Planning your trip'}</span>
          </div>
        </div>
        <div className="masthead-spacer" />
        {snapshot.user.linked && <div className="linked-chip">Telegram linked</div>}
      </header>

      {sampleData && (
        <div className="sample-banner">
          <span>◆</span>
          <span>Sample inventory - realistic but not bookable.</span>
        </div>
      )}

      {toast && (
        <div className="toast">
          <CheckCircle2 />
          <span>{toast}</span>
        </div>
      )}

      <Chat
        messages={snapshot.messages}
        greeting={snapshot.greeting}
        phase={snapshot.phase}
        busy={busy}
        error={error}
        onSend={send}
        carousels={carousels}
        cardStatus={cardStatus}
        tripDays={tripDays}
        loadingIndex={loadingIndex}
        onAccept={accept}
        onPass={pass}
        footer={
          snapshot.trip && (
            <ItineraryStrip plannedCount={plannedCount} tripDays={tripDays} onOpen={() => setSheetOpen(true)} />
          )
        }
      />

      <ItinerarySheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        itinerary={snapshot.itinerary}
        trip={snapshot.trip}
        preferences={snapshot.preferences}
        onRemove={remove}
        linked={snapshot.user.linked}
        linkCode={linkCode}
        onGetLinkCode={getLinkCode}
      />
    </div>
  )
}
