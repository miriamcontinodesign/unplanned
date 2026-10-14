import { Compass } from 'lucide-react'
import { ActivityArt } from './ActivityArt'
import { formatDuration, formatPrice } from '../format'
import type { PickItem } from '../types'

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function Picks({
  items,
  loading,
  onRemove,
}: {
  items: PickItem[]
  loading: boolean
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
      {items.map((item) => <PickRow key={item.id} item={item} onRemove={onRemove} />)}
    </div>
  )
}

function PickRow({
  item,
  onRemove,
}: {
  item: PickItem
  onRemove: (id: number) => void
}) {
  return (
    <div className="pick-item">
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
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${item.title}`}
          title="Remove"
        >
          ×
        </button>
      </div>
    </div>
  )
}
