import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { api } from './api'
import { Chat } from './components/Chat'
import { FooterTabs, type FooterTab } from './components/FooterTabs'
import { Landing } from './components/Landing'
import { PickDetail } from './components/PickDetail'
import { Picks } from './components/Picks'
import { TimeSlotPicker } from './components/TimeSlotPicker'
import type { DetectedPlace } from './geolocate'
import type { PickItem, Recommendation, Snapshot, TimeOfDay } from './types'

/** Best guess before the server has weighed in with the trip's own timezone. */
function guessSlot(): TimeOfDay {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [carousels, setCarousels] = useState<Record<number, Recommendation[]>>({})
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null)
  const [cardStatus, setCardStatus] = useState<Record<string, 'added' | 'passed'>>({})
  const [slot, setSlot] = useState<TimeOfDay>(guessSlot())
  const [hasStarted, setHasStarted] = useState(false)
  const [tab, setTab] = useState<FooterTab>('chat')
  const [picks, setPicks] = useState<PickItem[]>([])
  const [picksLoading, setPicksLoading] = useState(false)
  const [openPickId, setOpenPickId] = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // Recommendations aren't a separate view - each batch is pinned to the
  // assistant turn that was current when it was fetched, so it renders as a
  // carousel under that message instead of a global, ever-shifting list.
  const refreshRecommendations = useCallback(async (attachIndex: number, requestedSlot?: TimeOfDay) => {
    setLoadingIndex(attachIndex)
    try {
      const result = await api.recommendations(requestedSlot)
      setCarousels((prev) => ({ ...prev, [attachIndex]: result.recommendations }))
      setSlot(result.slot)
    } catch {
      // A failed refresh shouldn't blow away what's already on screen.
    } finally {
      setLoadingIndex((current) => (current === attachIndex ? null : current))
    }
  }, [])

  // Follow-up chips written by the model for the latest reply. Empty on failure, in which
  // case the chat falls back to its default chips.
  const refreshSuggestions = useCallback(async () => {
    setSuggestionsLoading(true)
    try {
      setSuggestions((await api.suggestions()).suggestions)
    } catch {
      setSuggestions([])
    } finally {
      setSuggestionsLoading(false)
    }
  }, [])

  const refreshPicks = useCallback(async () => {
    setPicksLoading(true)
    try {
      const result = await api.picks()
      setPicks(result.picks)
    } catch {
      // Leave whatever was already on screen.
    } finally {
      setPicksLoading(false)
    }
  }, [])

  useEffect(() => {
    api
      .me()
      .then((state) => {
        setSnapshot(state)
        // A returning session with history skips the landing screen entirely,
        // and does so before any transition helper is ever invoked - so it
        // never animates, it just renders already-expanded.
        if (state.messages.length > 0) setHasStarted(true)
        if (state.phase === 'ready' && state.messages.length > 0) {
          // No explicit slot yet - let the server pick from the trip's timezone.
          void refreshRecommendations(state.messages.length - 1)
          void refreshSuggestions()
          void refreshPicks()
        }
      })
      .catch((err: Error) => setError(err.message))
  }, [refreshRecommendations, refreshPicks, refreshSuggestions])

  const showToast = (text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  const send = async (text: string) => {
    // The landing screen expands into the chat the instant the traveler
    // acts, before the network round-trip resolves. Never flips back -
    // an error on the very first message must still land in the (now
    // expanded) chat log, not yank the screen back to the landing hero.
    if (!hasStarted) {
      const expand = () => setHasStarted(true)
      if (document.startViewTransition) {
        document.startViewTransition(() => flushSync(expand))
      } else {
        expand()
      }
    }

    // Show the traveler's message straight away; the server's snapshot replaces it
    // (with the same message plus the reply) when the answer arrives.
    setSnapshot((prev) =>
      prev
        ? { ...prev, messages: [...prev.messages, { role: 'user', text, at: new Date().toISOString() }] }
        : prev,
    )
    setBusy(true)
    setError(null)
    try {
      const next = await api.chat(text)
      setSnapshot(next)
      if (next.phase === 'ready' && next.messages.length > 0) {
        void refreshRecommendations(next.messages.length - 1, slot)
        setSuggestions(next.suggestions)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Resolves a detected location silently - no chat message, no expand. The
  // traveler still types their own first message afterwards.
  const setLocation = async (place: DetectedPlace): Promise<{ ok: true } | { ok: false; message: string }> => {
    try {
      setSnapshot(await api.setLocation(place))
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  const changeSlot = (next: TimeOfDay) => {
    setSlot(next)
    if (snapshot && snapshot.messages.length > 0) {
      void refreshRecommendations(snapshot.messages.length - 1, next)
    }
  }

  const accept = async (productCode: string) => {
    try {
      await api.accept(productCode, slot)
      setCardStatus((prev) => ({ ...prev, [productCode]: 'added' }))
      showToast('Added ✓')
      void refreshPicks()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const removePick = async (id: number) => {
    try {
      await api.removePick(id)
      setOpenPickId((current) => (current === id ? null : current))
      void refreshPicks()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const pass = async (productCode: string) => {
    try {
      await api.pass(productCode)
      setCardStatus((prev) => ({ ...prev, [productCode]: 'passed' }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Demo convenience: drop the session and reload as a brand new traveler.
  const reset = async () => {
    try {
      await api.reset()
    } finally {
      window.location.reload()
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

  if (!hasStarted) {
    return (
      <div className="app-shell">
        <Landing
          greeting={snapshot.greeting}
          busy={busy}
          error={error}
          tripLabel={snapshot.trip?.label ?? null}
          onSend={send}
          onLocate={setLocation}
        />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="masthead-avatar" style={{ viewTransitionName: 'roadio-brand' }}>
          <img src="/logo.png" alt="" />
        </div>
        <div className="masthead-titles">
          <div className="masthead-title-row">
            <span className="wordmark">Unplanned</span>
            {snapshot.trip && <span className="trip-badge">{snapshot.trip.city}</span>}
          </div>
          <div className="masthead-sub">
            <span className="pulse-dot" />
            <span>{snapshot.trip ? snapshot.trip.label : 'Planning your trip'}</span>
          </div>
        </div>
        <div className="masthead-spacer" />
        <button className="masthead-reset" onClick={reset} title="Back to start" aria-label="Back to start">
          <ArrowLeft />
        </button>
      </header>

      {snapshot.trip && tab === 'chat' && <TimeSlotPicker value={slot} onChange={changeSlot} />}

      {toast && (
        <div className="toast">
          <CheckCircle2 />
          <span>{toast}</span>
        </div>
      )}

      {tab === 'chat' ? (
        <Chat
          messages={snapshot.messages}
          greeting={snapshot.greeting}
          phase={snapshot.phase}
          busy={busy}
          error={error}
          onSend={send}
          carousels={carousels}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          cardStatus={cardStatus}
          loadingIndex={loadingIndex}
          onAccept={accept}
          onPass={pass}
          onLocate={setLocation}
        />
      ) : (
        openPickId !== null ? (
          <PickDetail id={openPickId} onBack={() => setOpenPickId(null)} onRemove={removePick} />
        ) : (
          <div className="pane">
            <div className="picks-scroll">
              <Picks items={picks} loading={picksLoading} onOpen={setOpenPickId} onRemove={removePick} />
            </div>
          </div>
        )
      )}

      {snapshot.trip && <FooterTabs
          tab={tab}
          picksCount={picks.length}
          onChange={(next) => {
            setOpenPickId(null)
            setTab(next)
          }}
        />}
    </div>
  )
}
