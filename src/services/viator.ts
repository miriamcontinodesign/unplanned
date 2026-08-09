import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { config } from '../config.js'
import { logger } from '../util/log.js'

const log = logger('viator')

export interface ExperienceDuration {
  fixedDurationInMinutes?: number
  variableDurationFromMinutes?: number
  variableDurationToMinutes?: number
}

export interface ViatorExperience {
  title: string
  code: string
  thumbnail?: string
  rating?: number
  reviewCount?: number
  freeCancellation: boolean
  fromPrice?: number
  fromPriceBeforeDiscount?: number
  clickOffToLander: string
  /** Optional operator contact for downstream calling workflows. */
  contactPhone?: string
  /** True when the contact number is synthetic and must never be dialed. */
  contactPhoneIsMock?: boolean
  /** Roadio-enriched context for a concise, explainable recommendation card. */
  recommendationContext?: {
    why: string
    neighborhood?: string
    walkingMinutes?: number
    crowdLevel?: 'quiet' | 'moderate' | 'busy'
    availableStartTimes?: string[]
    availability?: 'available' | 'limited' | 'unknown'
  }
  duration?: ExperienceDuration
  keyAttributes?: {
    features?: string[]
    mainCategory?: string
  }
}

export interface ExperienceSearchInput {
  searchTerm: string
  startDate: string
  endDate: string
  duration?: number
  fromPrice?: number
  toPrice?: number
  currency?: string
  locale?: string
  limit?: number
}

export interface ExperienceSearchResult {
  sessionId: string
  experiences: ViatorExperience[]
}

interface McpTextBlock {
  type: string
  text?: string
}

interface McpToolResult {
  isError?: boolean
  structuredContent?: unknown
  content?: McpTextBlock[]
}

let client: Client | null = null
let connecting: Promise<Client> | null = null
let callQueue: Promise<void> = Promise.resolve()

/** Stable without exposing the Telegram user id to Viator. */
export function viatorSessionId(userId: string): string {
  const hex = createHash('sha256').update(`roadio-viator:${userId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function getClient(): Promise<Client> {
  if (client) return client
  if (connecting) return connecting

  connecting = (async () => {
    const next = new Client({ name: 'roadio', version: '0.1.0' })
    const transport = new StreamableHTTPClientTransport(new URL(config.viatorMcpUrl))
    await next.connect(transport)
    client = next
    log.info('connected to Viator MCP')
    return next
  })()

  try {
    return await connecting
  } finally {
    connecting = null
  }
}

async function resetClient(): Promise<void> {
  const stale = client
  client = null
  connecting = null
  if (stale) await stale.close().catch(() => undefined)
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = callQueue.then(operation, operation)
  callQueue = result.then(() => undefined, () => undefined)
  return result
}

function parseToolResult(result: McpToolResult): ExperienceSearchResult {
  let value = result.structuredContent
  if (!value) {
    const text = result.content?.find((block) => block.type === 'text' && block.text)?.text
    if (text) value = JSON.parse(text)
  }

  if (result.isError) {
    const message = result.content?.map((block) => block.text).filter(Boolean).join(' ')
    throw new Error(message || 'Viator returned an error.')
  }

  if (!value || typeof value !== 'object') {
    throw new Error('Viator returned an unreadable response.')
  }

  const record = value as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || !Array.isArray(record.experiences)) {
    throw new Error('Viator returned an unexpected response shape.')
  }

  const experiences = record.experiences.filter(isExperience)
  return { sessionId: record.sessionId, experiences }
}

function isExperience(value: unknown): value is ViatorExperience {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.title === 'string' &&
    typeof item.code === 'string' &&
    typeof item.clickOffToLander === 'string' &&
    typeof item.freeCancellation === 'boolean'
  )
}

function retryDelay(error: unknown, attempt: number): number | null {
  const message = error instanceof Error ? error.message : String(error)
  const retryAfter = message.match(/retry after\s+(\d+(?:\.\d+)?)\s*(?:seconds?|s)?/i)
  if (retryAfter) {
    const milliseconds = Math.ceil(Number(retryAfter[1]) * 1000)
    return milliseconds <= 5_000 ? milliseconds : null
  }
  return attempt === 0 && /429|rate.?limit|temporar|timeout|ECONNRESET|fetch failed/i.test(message)
    ? 500
    : null
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function searchExperiences(
  userId: string,
  input: ExperienceSearchInput,
): Promise<ExperienceSearchResult> {
  return serial(async () => {
    const arguments_ = {
      ...input,
      limit: Math.min(10, Math.max(1, input.limit ?? 3)),
      sessionId: viatorSessionId(userId),
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const active = await getClient()
        const result = (await active.callTool({
          name: 'search_experiences',
          arguments: arguments_,
        })) as McpToolResult
        return parseToolResult(result)
      } catch (error) {
        await resetClient()
        const wait = retryDelay(error, attempt)
        if (wait === null || attempt === 1) throw error
        log.warn(`Viator search failed; retrying in ${wait}ms`)
        await delay(wait)
      }
    }

    throw new Error('Viator search failed.')
  })
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`
}

function durationLabel(duration?: ExperienceDuration): string | null {
  if (!duration) return null
  if (duration.fixedDurationInMinutes !== undefined) {
    return minutesLabel(duration.fixedDurationInMinutes)
  }
  const from = duration.variableDurationFromMinutes
  const to = duration.variableDurationToMinutes
  if (from !== undefined && to !== undefined) {
    return from === to ? minutesLabel(from) : `${minutesLabel(from)}–${minutesLabel(to)}`
  }
  if (from !== undefined) return `from ${minutesLabel(from)}`
  if (to !== undefined) return `up to ${minutesLabel(to)}`
  return null
}

export function formatExperienceResults(
  result: ExperienceSearchResult,
  currency = 'USD',
): string {
  if (result.experiences.length === 0) {
    return 'Viator found no matching bookable experiences for those dates and filters.'
  }

  const money = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  })

  return result.experiences
    .map((experience, index) => {
      const facts: string[] = []
      if (experience.fromPrice !== undefined) {
        facts.push(`from ${money.format(experience.fromPrice)} per person`)
      }
      if (experience.rating !== undefined) {
        const reviews = experience.reviewCount === undefined
          ? ''
          : ` (${experience.reviewCount.toLocaleString('en')} reviews)`
        facts.push(`${experience.rating.toFixed(1)}/5${reviews}`)
      }
      const duration = durationLabel(experience.duration)
      if (duration) facts.push(duration)
      if (experience.freeCancellation) facts.push('free cancellation')
      if (experience.keyAttributes?.mainCategory) facts.push(experience.keyAttributes.mainCategory)

      const contact = experience.contactPhone
        ? `${experience.contactPhoneIsMock ? 'Mock operator phone' : 'Operator phone'}: ${experience.contactPhone}`
        : null
      const context = experience.recommendationContext
      const cardContext = context
        ? [
            context.neighborhood,
            context.walkingMinutes === undefined ? null : `${context.walkingMinutes}-min walk`,
            context.crowdLevel ? `${context.crowdLevel} atmosphere` : null,
            context.availableStartTimes?.length
              ? `times: ${context.availableStartTimes.join(', ')}`
              : null,
            context.availability && context.availability !== 'unknown'
              ? context.availability
              : null,
          ].filter(Boolean).join(' · ')
        : null

      return [
        `${index + 1}. ${experience.title} [product ${experience.code}]`,
        context?.why ? `Why it fits: ${context.why}` : null,
        cardContext,
        facts.join(' · '),
        contact,
        experience.clickOffToLander,
      ].filter(Boolean).join('\n')
    })
    .join('\n\n')
}
