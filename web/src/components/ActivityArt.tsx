/**
 * Deterministic card art.
 *
 * The sample catalogue has no imagery, and inventing photographs of real places
 * would be a lie. A gradient derived from the product code is stable, loads
 * instantly, needs no external host, and reads as deliberate rather than broken.
 */

const GLYPHS: Array<[string, string]> = [
  ['food', '🍽'],
  ['nightlife', '🍸'],
  ['water', '⛵'],
  ['outdoors', '⛰'],
  ['active', '🚲'],
  ['art', '🎨'],
  ['history', '🏛'],
  ['wellness', '♨'],
  ['scenic', '📷'],
  ['private', '🗝'],
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

export function ActivityArt({
  seed,
  tags,
  className = 'card-art',
}: {
  seed: string
  tags: string[]
  className?: string
}) {
  const hue = hash(seed) % 360
  const second = (hue + 42) % 360

  return (
    <div
      className={className}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 46% 32%), hsl(${second} 52% 20%))`,
      }}
      aria-hidden="true"
    >
      {glyphFor(tags)}
    </div>
  )
}
