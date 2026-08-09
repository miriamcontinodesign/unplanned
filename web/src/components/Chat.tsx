import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Phase } from '../types'

const PROMPTS: Record<Phase, string[]> = {
  need_destination: ['Lisbon for 5 days', 'Tokyo, 8 days', 'Mexico City'],
  need_days: ['4 days', 'a week', '10 days'],
  ready: ['I love food and street markets', 'nothing too touristy', 'travelling as a couple'],
}

export function Chat({
  messages,
  greeting,
  phase,
  busy,
  error,
  onSend,
}: {
  messages: ChatMessage[]
  greeting: string
  phase: Phase
  busy: boolean
  error: string | null
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy])

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

        {messages.map((message, index) => (
          <div key={index} className={`bubble ${message.role}`}>
            {message.text}
          </div>
        ))}

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
          {PROMPTS[phase].map((prompt) => (
            <button key={prompt} onClick={() => submit(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          submit(draft)
        }}
      >
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
        <button type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
