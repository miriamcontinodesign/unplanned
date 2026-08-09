import { Send } from 'lucide-react'
import type { RefObject } from 'react'

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  busy,
  inputRef,
  morph,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  busy: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  /** View Transition name so the browser morphs this between the landing hero and the pinned-bottom chat position. */
  morph?: boolean
}) {
  return (
    <form
      className="composer"
      style={morph ? { viewTransitionName: 'composer' } : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="composer-field">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoFocus
          aria-label="Message"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className={`composer-send ${value.trim() && !busy ? 'ready' : 'disabled'}`}
          aria-label="Send"
        >
          <Send />
        </button>
      </div>
    </form>
  )
}
