import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { Chat } from './components/Chat'
import { Itinerary } from './components/Itinerary'
import { Suggestions } from './components/Suggestions'
import type { Recommendation, Snapshot } from './types'

type Tab = 'suggestions' | 'itinerary'

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [sampleData, setSampleData] = useState(false)
  const [tab, setTab] = useState<Tab>('suggestions')
  const [busy, setBusy] = useState(false)
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkCode, setLinkCode] = useState<string | null>(null)

  const refreshRecommendations = useCallback(async () => {
    setLoadingRecs(true)
    try {
      const result = await api.recommendations()
      setRecommendations(result.recommendations)
      setSampleData(Boolean(result.sampleData))
    } catch {
      // A failed refresh shouldn't blow away what's already on screen.
    } finally {
      setLoadingRecs(false)
    }
  }, [])

  useEffect(() => {
    api
      .me()
      .then((state) => {
        setSnapshot(state)
        if (state.phase === 'ready') void refreshRecommendations()
      })
      .catch((err: Error) => setError(err.message))
  }, [refreshRecommendations])

  const send = async (text: string) => {
    setBusy(true)
    setError(null)
    try {
      const wasReady = snapshot?.phase === 'ready'
      const next = await api.chat(text)
      setSnapshot(next)
      // Refresh once onboarding completes, and again whenever a later turn
      // might have changed what we know about their taste.
      if (next.phase === 'ready') {
        if (!wasReady) setTab('suggestions')
        void refreshRecommendations()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const accept = async (productCode: string, day: number) => {
    // Optimistic: drop the card immediately, the itinerary count updates on response.
    setRecommendations((prev) => prev.filter((r) => r.productCode !== productCode))
    try {
      setSnapshot(await api.accept(productCode, day))
    } catch (err) {
      setError((err as Error).message)
      void refreshRecommendations()
    }
  }

  const pass = async (productCode: string) => {
    setRecommendations((prev) => prev.filter((r) => r.productCode !== productCode))
    try {
      setSnapshot(await api.pass(productCode))
    } catch (err) {
      setError((err as Error).message)
      void refreshRecommendations()
    }
  }

  const remove = async (id: number) => {
    try {
      setSnapshot(await api.remove(id))
      void refreshRecommendations()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!snapshot) {
    return (
      <div className="empty" style={{ paddingTop: '30vh' }}>
        <h3>{error ? 'Could not reach the server' : 'Loading'}</h3>
        {error && <p>{error}</p>}
      </div>
    )
  }

  const plannedCount = snapshot.itinerary.reduce((total, day) => total + day.items.length, 0)
  const tripDays = snapshot.trip?.days ?? 3

  return (
    <div className="app">
      <header className="masthead">
        <div className="wordmark">
          road<span>io</span>
        </div>
        {snapshot.trip && (
          <div className="trip-chip">
            <strong>{snapshot.trip.label}</strong>
            {snapshot.trip.days && <span>· {snapshot.trip.days} days</span>}
          </div>
        )}
        <div className="masthead-spacer" />
        {snapshot.user.linked && <div className="trip-chip">Telegram linked</div>}
      </header>

      <div className="panes">
        <Chat
          messages={snapshot.messages}
          greeting={snapshot.greeting}
          phase={snapshot.phase}
          busy={busy}
          error={error}
          onSend={send}
        />

        <div className="pane">
          <div className="tabs">
            <button
              className={tab === 'suggestions' ? 'active' : ''}
              onClick={() => setTab('suggestions')}
            >
              Suggestions
              {recommendations.length > 0 && <span className="tab-count">{recommendations.length}</span>}
            </button>
            <button
              className={tab === 'itinerary' ? 'active' : ''}
              onClick={() => setTab('itinerary')}
            >
              Itinerary
              {plannedCount > 0 && <span className="tab-count">{plannedCount}</span>}
            </button>
          </div>

          <div className="pane-body">
            {tab === 'suggestions' ? (
              snapshot.phase !== 'ready' ? (
                <div className="empty">
                  <h3>Tell me about the trip first</h3>
                  <p>
                    Where you're going and roughly how long. Then I'll pull together things worth
                    doing.
                  </p>
                </div>
              ) : (
                <Suggestions
                  recommendations={recommendations}
                  tripDays={tripDays}
                  sampleData={sampleData}
                  loading={loadingRecs}
                  onAccept={accept}
                  onPass={pass}
                />
              )
            ) : (
              <>
                <Itinerary
                  itinerary={snapshot.itinerary}
                  trip={snapshot.trip}
                  preferences={snapshot.preferences}
                  onRemove={remove}
                />

                {snapshot.trip && !snapshot.user.linked && (
                  <div className="link-card">
                    <h4>Take this with you</h4>
                    <p>
                      Link Telegram and the same memory follows you on the road - ask anything, and
                      it speaks up when something's worth doing.
                    </p>
                    {linkCode ? (
                      <div className="link-code">{linkCode}</div>
                    ) : (
                      <button
                        className="btn-secondary"
                        onClick={async () => {
                          try {
                            const result = await api.linkCode()
                            setLinkCode(result.code)
                          } catch (err) {
                            setError((err as Error).message)
                          }
                        }}
                      >
                        Get link code
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
