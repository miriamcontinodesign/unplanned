import { geocode, type GeoResult } from '../services/geocode.js'

/**
 * Deterministic parsing of onboarding chat.
 *
 * This is the primary path, not a fallback. Free text is normally a model call,
 * but the two things onboarding must capture - a place and a duration - are
 * narrow enough to parse in code, and the place can be *verified* by geocoding
 * rather than guessed. That keeps the core flow working with no credentials and
 * costs nothing per turn. The model layers on top to catch what this misses.
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
}

/** Phrases that carry no meaning once the place and duration are extracted. */
const LEADING_FILLER = [
  "i'm going to",
  'i am going to',
  "i'm heading to",
  'i am heading to',
  "i'm travelling to",
  "i'm traveling to",
  'i am travelling to',
  'i am traveling to',
  "i'm off to",
  "i'm visiting",
  'i am visiting',
  'we are going to',
  "we're going to",
  "we're heading to",
  'planning a trip to',
  'planning to visit',
  'thinking about',
  'going to',
  'heading to',
  'travelling to',
  'traveling to',
  'flying to',
  'visiting',
  'trip to',
  'holiday in',
  'vacation in',
  'staying in',
  'i want to go to',
  'want to go to',
  'lets go to',
  "let's go to",
]

const TRAILING_FILLER = ['please', 'thanks', 'thank you']

/** Interest keywords mapped onto the catalogue's tag vocabulary. */
const INTEREST_KEYWORDS: Record<string, string[]> = {
  food: ['food', 'eat', 'eating', 'restaurant', 'restaurants', 'cuisine', 'culinary', 'foodie', 'dining', 'street food'],
  history: ['history', 'historic', 'historical', 'ruins', 'ancient', 'heritage', 'castle', 'castles'],
  art: ['art', 'arts', 'museum', 'museums', 'gallery', 'galleries', 'design', 'architecture'],
  outdoors: ['outdoors', 'outdoor', 'hike', 'hiking', 'nature', 'trek', 'trekking', 'mountains', 'walk', 'walking'],
  nightlife: ['nightlife', 'bars', 'bar', 'clubs', 'clubbing', 'party', 'drinks', 'cocktails'],
  wellness: ['spa', 'wellness', 'relax', 'relaxing', 'baths', 'thermal', 'massage'],
  water: ['beach', 'beaches', 'boat', 'sailing', 'kayak', 'surf', 'surfing', 'swim', 'swimming'],
  offbeat: ['offbeat', 'unusual', 'hidden', 'local', 'authentic', 'off the beaten', 'quirky'],
  active: ['bike', 'biking', 'cycling', 'active', 'adventure', 'climbing'],
  scenic: ['views', 'scenery', 'scenic', 'sunset', 'photography', 'photos'],
}

const BUDGET_KEYWORDS: Record<string, string[]> = {
  shoestring: ['cheap', 'budget', 'shoestring', 'backpacking', 'backpacker', 'affordable', 'low cost'],
  moderate: ['moderate', 'mid range', 'mid-range', 'reasonable', 'average'],
  comfortable: ['comfortable', 'comfy', 'nice', 'treat', 'upscale'],
  luxury: ['luxury', 'luxurious', 'high end', 'high-end', 'splurge', 'five star', '5 star'],
}

export interface ParsedTurn {
  /** Verified place, present only when geocoding resolved it. */
  destination: GeoResult | null
  /** Raw text we believed was a place but could not verify. */
  unresolvedPlace: string | null
  days: number | null
  interests: string[]
  budgetLevel: 'shoestring' | 'moderate' | 'comfortable' | 'luxury' | null
  partySize: number | null
}

/** Pull a trip length out of free text. Weeks are converted to days. */
export function parseDays(input: string): number | null {
  const text = input.toLowerCase()

  const numeric = /(\d+)\s*(day|night|week)s?\b/.exec(text)
  if (numeric) {
    const value = Number.parseInt(numeric[1]!, 10)
    if (Number.isFinite(value) && value > 0) {
      return numeric[2] === 'week' ? value * 7 : value
    }
  }

  const worded = new RegExp(
    `\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s*(day|night|week)s?\\b`,
  ).exec(text)
  if (worded) {
    const value = NUMBER_WORDS[worded[1]!]
    if (value) return worded[2] === 'week' ? value * 7 : value
  }

  // A bare number is only a duration when the message says nothing else.
  const bare = /^\s*(\d{1,2})\s*$/.exec(text)
  if (bare) {
    const value = Number.parseInt(bare[1]!, 10)
    if (value > 0 && value <= 60) return value
  }

  return null
}

export function parsePartySize(input: string): number | null {
  const text = input.toLowerCase()
  if (/\b(solo|alone|by myself|just me|on my own)\b/.test(text)) return 1
  if (/\b(couple|partner|girlfriend|boyfriend|wife|husband|the two of us)\b/.test(text)) return 2

  const explicit = /\b(\d+)\s*(people|persons|travell?ers|of us|adults)\b/.exec(text)
  if (explicit) {
    const value = Number.parseInt(explicit[1]!, 10)
    if (value > 0 && value <= 20) return value
  }

  const worded = new RegExp(
    `\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s*(people|persons|travell?ers|of us|adults)\\b`,
  ).exec(text)
  if (worded) return NUMBER_WORDS[worded[1]!] ?? null

  return null
}

export function parseInterests(input: string): string[] {
  const text = input.toLowerCase()
  const found = new Set<string>()
  for (const [tag, keywords] of Object.entries(INTEREST_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) found.add(tag)
  }
  return [...found]
}

export function parseBudget(input: string): ParsedTurn['budgetLevel'] {
  const text = input.toLowerCase()
  for (const [level, keywords] of Object.entries(BUDGET_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return level as ParsedTurn['budgetLevel']
    }
  }
  return null
}

/**
 * Strip duration and filler, then treat what is left as a candidate place.
 * Returns null when nothing plausible remains.
 */
export function candidatePlace(input: string): string | null {
  let text = input.trim().toLowerCase()

  text = text
    .replace(/\b\d+\s*(day|night|week)s?\b/g, ' ')
    .replace(
      new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s*(day|night|week)s?\\b`, 'g'),
      ' ',
    )
    .replace(/\bfor\b/g, ' ')
    .replace(/\bnext (week|month|year|summer|winter|spring|autumn|fall)\b/g, ' ')

  for (const filler of LEADING_FILLER) {
    if (text.startsWith(filler)) {
      text = text.slice(filler.length)
      break
    }
  }
  for (const filler of TRAILING_FILLER) {
    if (text.endsWith(filler)) text = text.slice(0, -filler.length)
  }

  text = text
    .replace(/^[\s,.!?;:-]+|[\s,.!?;:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return null
  // Long sentences are prose, not a place name.
  if (text.split(' ').length > 5) return null
  if (/^(yes|no|yeah|nope|ok|okay|sure|hi|hello|hey|thanks|maybe)$/.test(text)) return null

  return text
}

/**
 * Parse a single chat turn. Geocoding is what turns a guess into a fact, so a
 * destination is only reported when a real place resolved.
 */
export async function parseTurn(input: string): Promise<ParsedTurn> {
  const days = parseDays(input)
  const interests = parseInterests(input)
  const budgetLevel = parseBudget(input)
  const partySize = parsePartySize(input)

  const candidate = candidatePlace(input)
  let destination: GeoResult | null = null
  if (candidate) destination = await geocode(candidate)

  return {
    destination,
    unresolvedPlace: destination ? null : candidate,
    days,
    interests,
    budgetLevel,
    partySize,
  }
}
