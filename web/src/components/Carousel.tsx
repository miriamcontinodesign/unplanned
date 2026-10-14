import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Horizontally scrolling row of cards with a result count and arrow buttons for mouse users. */
export function Carousel({ count, children }: { count: number; children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const update = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    // Only offer arrows when a card is actually cut off, not for a few pixels of slack.
    const overflows = track.scrollWidth - track.clientWidth > 24
    setCanPrev(overflows && track.scrollLeft > 4)
    setCanNext(overflows && track.scrollLeft + track.clientWidth < track.scrollWidth - 4)
  }, [])

  useEffect(() => {
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [update, count])

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector<HTMLElement>('.rec-card')
    const step = (card?.offsetWidth ?? track.clientWidth * 0.8) + 10
    track.scrollBy({ left: direction * step, behavior: 'smooth' })
  }

  return (
    <div className="carousel-wrap">
      <div className="carousel-head">
        <span className="carousel-count">
          {count} {count === 1 ? 'result' : 'results'}
        </span>
        {(canPrev || canNext) && (
          <div className="carousel-arrows">
            <button type="button" onClick={() => scrollBy(-1)} disabled={!canPrev} aria-label="Previous results">
              <ChevronLeft />
            </button>
            <button type="button" onClick={() => scrollBy(1)} disabled={!canNext} aria-label="Next results">
              <ChevronRight />
            </button>
          </div>
        )}
      </div>
      <div className="carousel" ref={trackRef} onScroll={update}>
        {children}
      </div>
    </div>
  )
}
