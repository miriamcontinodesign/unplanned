import { useEffect, useRef, useState } from 'react'
import { Composer } from './Composer'
import { LocateButton } from './LocateButton'
import { RecommendationCard } from './RecommendationCard'
import { formatTime } from '../format'
import type { DetectedPlace } from '../geolocate'
import type { ChatMessage, Phase, Recommendation } from '../types'

export const PROMPTS: Record<Phase, string[]> = {
  need_destination: ['Lisbon', 'Tokyo', 'Mexico City'],
  ready: ['I love food and street markets', 'nothing too touristy', "a couple's night out"],
}

export function Chat({
  messages,
  greeting,
  phase,
  busy,
  error,
  onSend,
  carousels,
  suggestions,
  suggestionsLoading,
  cardStatus,
  loadingIndex,
  onAccept,
  onPass,
  onLocate,
}: {
  messages: ChatMessage[]
  greeting: string
  phase: Phase
  busy: boolean
  error: string | null
  onSend: (text: string) => void
  carousels: Record<number, Recommendation[]>
  suggestions: string[]
  suggestionsLoading: boolean
  cardStatus: Record<string, 'added' | 'passed'>
  loadingIndex: number | null
  onAccept: (productCode: string) => void
  onPass: (productCode: string) => void
  onLocate: (place: DetectedPlace) => Promise<{ ok: true } | { ok: false; message: string }>
}) {
  const [draft, setDraft] = useState('')
  const [locatePrompt, setLocatePrompt] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy, loadingIndex, locatePrompt])

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="pane">
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && <div className="bubble assistant">{greeting}</div>}

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
                <div className="carousel">
                  {cards.map((item) => (
                    <RecommendationCard
                      key={item.productCode}
                      item={item}
                      status={cardStatus[item.productCode]}
                      onAccept={() => onAccept(item.productCode)}
                      onPass={() => onPass(item.productCode)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {locatePrompt && <div className="bubble assistant">{locatePrompt}</div>}

        {busy && (
          <div className="typing" aria-label="Thinking">
            <i />
            <i />
            <i />
          </div>
        )}

        {error && <div className="bubble error">{error}</div>}
      </div>

      {!busy && phase === 'need_destination' && (
        <LocateButton
          onDetected={async (place) => {
            const result = await onLocate(place)
            setLocatePrompt(result.ok ? `You're in ${place.city}. What are you up to?` : result.message)
            inputRef.current?.focus()
          }}
          onFailure={(message) => {
            setLocatePrompt(message)
            inputRef.current?.focus()
          }}
        />
      )}

      {!busy && !(phase === 'ready' && suggestionsLoading) && (
        <div className="suggestion-row">
          {(phase === 'ready' && suggestions.length > 0 ? suggestions : PROMPTS[phase]).map((prompt) => (
            <button key={prompt} onClick={() => submit(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      )}

      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => submit(draft)}
        placeholder={phase === 'need_destination' ? 'Where are you?' : 'Tell me what you like...'}
        busy={busy}
        inputRef={inputRef}
        morph
      />
    </div>
  )
}
