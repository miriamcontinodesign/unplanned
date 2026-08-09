import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import { RecommendationCard } from './RecommendationCard'
import { RecommendationMap } from './RecommendationMap'
import { formatTime } from '../format'
import type { ChatMessage, Phase, Recommendation } from '../types'

const PROMPTS: Record<Phase, string[]> = {
  need_destination: ['Lisbon for 5 days', 'Tokyo, 8 days', 'Mexico City'],
  need_days: ['4 days', 'a week', '10 days'],
  ready: ['I love food and street markets', 'nothing too touristy', 'travelling as a couple'],
}

export function Chat({
  messages,
  phase,
  busy,
  error,
  onSend,
  carousels,
  cardStatus,
  tripDays,
  loadingIndex,
  onAccept,
  onCall,
  onPass,
  footer,
}: {
  messages: ChatMessage[]
  phase: Phase
  busy: boolean
  error: string | null
  onSend: (text: string) => void
  carousels: Record<number, Recommendation[]>
  cardStatus: Record<string, 'added' | 'passed'>
  tripDays: number
  loadingIndex: number | null
  onAccept: (productCode: string, day: number) => void
  onCall: (productCode: string, day: number) => Promise<'handed_off'>
  onPass: (productCode: string) => void
  footer?: ReactNode
}) {
  const [draft, setDraft] = useState('')
  const [shownMapKeys, setShownMapKeys] = useState<Set<string>>(() => new Set())
  const logRef = useRef<HTMLDivElement>(null)

  const latestSearchKey = useMemo(() => Object.entries(carousels)
    .filter(([, items]) => items.length > 0)
    .sort(([left], [right]) => Number(right) - Number(left))[0]?.[0] ?? null, [carousels])

  const mapItems = useMemo(() => {
    const latest = latestSearchKey === null ? [] : carousels[Number(latestSearchKey)] ?? []
    return latest
      .filter((item) => cardStatus[item.productCode] !== 'passed')
      .slice(0, 10)
  }, [carousels, cardStatus, latestSearchKey])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy, loadingIndex, shownMapKeys.size, mapItems.length])

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="pane">
      <div className="chat-log" ref={logRef}>
        {messages.map((message, index) => {
          const cards = carousels[index]
          const showSkeleton = loadingIndex === index && !cards

          return (
            <div key={index} className={`msg-group ${message.role}`}>
              <div className={`bubble ${message.role}`}>{message.text}</div>
              <span className="msg-time">{formatTime(message.at)}</span>

              {showSkeleton && (
                <div className="rec-loading">
                  <div className="rec-skel" />
                  <div className="rec-skel" />
                </div>
              )}

              {cards && cards.length > 0 && (
                <>
                  <div className="carousel">
                    {cards.map((item) => (
                    <RecommendationCard
                      key={item.productCode}
                      item={item}
                      tripDays={tripDays}
                      status={cardStatus[item.productCode]}
                      onAccept={(day) => onAccept(item.productCode, day)}
                      onCall={(day) => onCall(item.productCode, day)}
                      onPass={() => onPass(item.productCode)}
                    />
                    ))}
                  </div>
                  {shownMapKeys.has(String(index)) && (
                    <div className="msg-group assistant map-message">
                      <RecommendationMap
                        items={cards.filter((item) => cardStatus[item.productCode] !== 'passed').slice(0, 10)}
                        onClose={() => setShownMapKeys((current) => {
                          const next = new Set(current)
                          next.delete(String(index))
                          return next
                        })}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}

        {busy && (
          <div className="typing" aria-label="Thinking">
            <i />
            <i />
            <i />
          </div>
        )}

        {error && <div className="bubble error">{error}</div>}

      </div>

      {!busy && (
        <div className="suggestion-row">
          {phase === 'ready' && mapItems.length > 0 && (
            <button onClick={() => {
              if (latestSearchKey === null) return
              setShownMapKeys((current) => new Set(current).add(latestSearchKey))
            }}>
              show on map
            </button>
          )}
          {PROMPTS[phase].map((prompt) => (
            <button key={prompt} onClick={() => submit(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      )}

      {footer}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          submit(draft)
        }}
      >
        <div className="composer-field">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              phase === 'need_destination'
                ? 'Where are you going?'
                : phase === 'need_days'
                  ? 'How many days?'
                  : 'Tell me what you like...'
            }
            autoFocus
            aria-label="Message"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className={`composer-send ${draft.trim() && !busy ? 'ready' : 'disabled'}`}
            aria-label="Send"
          >
            <Send />
          </button>
        </div>
      </form>
    </div>
  )
}
