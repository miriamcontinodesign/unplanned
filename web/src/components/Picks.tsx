import { useState } from 'react'
import { Compass, PhoneCall } from 'lucide-react'
import { ActivityArt } from './ActivityArt'
import { formatDuration, formatPrice } from '../format'
import type { PickItem } from '../types'

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function Picks({
  items,
  loading,
  onBook,
  onRemove,
}: {
  items: PickItem[]
  loading: boolean
  onBook: (productCode: string) => Promise<'handed_off'>
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
      {items.map((item) => <PickRow key={item.id} item={item} onBook={onBook} onRemove={onRemove} />)}
    </div>
  )
}

function PickRow({
  item,
  onBook,
  onRemove,
}: {
  item: PickItem
  onBook: (productCode: string) => Promise<'handed_off'>
  onRemove: (id: number) => void
}) {
  const [bookStatus, setBookStatus] = useState<'idle' | 'opening' | 'handed_off' | 'unavailable'>('idle')

  const book = async () => {
    if (!item.productCode || bookStatus === 'opening' || bookStatus === 'handed_off') return
    setBookStatus('opening')
    try {
      setBookStatus(await onBook(item.productCode))
    } catch {
      setBookStatus('unavailable')
    }
  }

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
        {item.productCode && (
          <button
            className={`btn-call pick-book is-${bookStatus === 'opening' ? 'calling' : bookStatus}`}
            onClick={() => void book()}
            disabled={bookStatus === 'opening' || bookStatus === 'handed_off'}
          >
            <PhoneCall />
            <span>
              {bookStatus === 'idle' && 'Book'}
              {bookStatus === 'opening' && 'Opening…'}
              {bookStatus === 'handed_off' && 'Opened'}
              {bookStatus === 'unavailable' && 'Try again'}
            </span>
          </button>
        )}
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
