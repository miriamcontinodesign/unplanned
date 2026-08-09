/**
 * Deterministic card art.
 *
 * The sample catalogue has no imagery, and inventing photographs of real places
 * would be a lie. A gradient derived from the product code is stable, loads
 * instantly, needs no external host, and reads as deliberate rather than broken.
 */

const GLYPHS: Array<[string, string, string]> = [
  ['food', '🍽', 'Food'],
  ['nightlife', '🍸', 'Nightlife'],
  ['water', '⛵', 'Water'],
  ['outdoors', '⛰', 'Outdoors'],
  ['active', '🚲', 'Active'],
  ['art', '🎨', 'Art'],
  ['history', '🏛', 'History'],
  ['wellness', '♨', 'Wellness'],
  ['scenic', '📷', 'Scenic'],
  ['private', '🗝', 'Private'],
]

function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function glyphFor(tags: string[]): string {
  for (const [tag, glyph] of GLYPHS) {
    if (tags.includes(tag)) return glyph
  }
  return '📍'
}

export function categoryFor(tags: string[]): string {
  for (const [tag, , label] of GLYPHS) {
    if (tags.includes(tag)) return label
  }
  return 'Activity'
}

export function gradientFor(seed: string): string {
  const hue = hash(seed) % 360
  const second = (hue + 42) % 360
  return `linear-gradient(140deg, hsl(${hue} 58% 36%), hsl(${second} 62% 20%))`
}

export function ActivityArt({
  seed,
  tags,
  className = 'card-art',
}: {
  seed: string
  tags: string[]
  className?: string
}) {
  return (
    <div className={className} style={{ background: gradientFor(seed) }} aria-hidden="true">
      {glyphFor(tags)}
    </div>
  )
}
