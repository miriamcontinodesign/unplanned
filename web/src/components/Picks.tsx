import { ChevronRight, Compass } from 'lucide-react'
import { ActivityArt } from './ActivityArt'
import { formatDuration, formatPrice } from '../format'
import type { PickItem } from '../types'

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function Picks({
  items,
  loading,
  onOpen,
  onRemove,
}: {
  items: PickItem[]
  loading: boolean
  onOpen: (id: number) => void
  onRemove: (id: number) => void
}) {
  if (loading) {
    return (
      <div className="empty">
        <h3>Loading your picks</h3>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="empty">
        <Compass className="empty-icon" />
        <h3>Nothing added yet</h3>
        <p>Head back to chat and add something that looks good - it'll show up here.</p>
      </div>
    )
  }

  return (
    <div className="picks-list">
      {items.map((item) => <PickRow key={item.id} item={item} onOpen={onOpen} onRemove={onRemove} />)}
    </div>
  )
}

function PickRow({
  item,
  onOpen,
  onRemove,
}: {
  item: PickItem
  onOpen: (id: number) => void
  onRemove: (id: number) => void
}) {
  return (
    <div
      className="pick-item"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(item.id)
        }
      }}
    >
      <ActivityArt seed={item.productCode ?? item.title} tags={[]} />
      <div className="pick-item-body">
        <h4>{item.title}</h4>
        <p>
          {[
            item.atTime ? capitalize(item.atTime) : null,
            formatDuration(item.durationMinutes),
            item.priceAmount ? formatPrice({ amount: item.priceAmount, currency: item.currency ?? 'USD' }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="pick-actions">
        <button
          className="btn-remove"
          onClick={(event) => {
            event.stopPropagation()
            onRemove(item.id)
          }}
          aria-label={`Remove ${item.title}`}
          title="Remove"
        >
          ×
        </button>
        <ChevronRight className="pick-chevron" />
      </div>
    </div>
  )
}
