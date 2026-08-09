import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { anthropic } from './client.js'
import { config, effort } from '../config.js'
import { EXTRACTOR_SYSTEM } from './prompts.js'
import { renderTravelerState } from './state.js'
import { geocode } from '../services/geocode.js'
import {
  addJournalEntry,
  addPlan,
  addPreference,
  currentStay,
  listOpenPlans,
  setPlanStatus,
  setStayGeo,
  upsertCurrentStay,
} from '../db/repo.js'
import { describeError, logger } from '../util/log.js'

const log = logger('extract')

/**
 * Every field is nullable rather than optional: strict structured outputs want
 * all properties present with `additionalProperties: false`, so "no new
 * information" has to be an explicit null rather than an absent key.
 */
const Extraction = z.object({
  stay: z
    .object({
      city: z.string(),
      country: z.string().nullable(),
      lodgingName: z.string().nullable(),
      lodgingArea: z.string().nullable(),
      arrivalDate: z.string().nullable(),
      departureDate: z.string().nullable(),
    })
    .nullable(),
  newPlans: z.array(
    z.object({
      title: z.string(),
      detail: z.string().nullable(),
      onDate: z.string().nullable(),
      atTime: z.string().nullable(),
    }),
  ),
  planStatusUpdates: z.array(
    z.object({
      planId: z.number(),
      status: z.enum(['idea', 'booked', 'done', 'dropped']),
    }),
  ),
  newPreferences: z.array(
    z.object({
      kind: z.enum(['like', 'dislike', 'constraint']),
      text: z.string(),
    }),
  ),
  journalEntries: z.array(
    z.object({
      text: z.string(),
      occurredOn: z.string().nullable(),
    }),
  ),
})

export type Extraction = z.infer<typeof Extraction>

/**
 * Pass one of two. Runs on every inbound message and is the only thing that
 * writes trip state, so a chatty reply can never silently forget to record
 * where someone is.
 */
export async function extractAndApply(
  userId: string,
  newMessage: string,
  transcript: string,
): Promise<Extraction | null> {
  let extraction: Extraction
  try {
    const response = await anthropic.messages.parse({
      model: config.model,
      max_tokens: 8000,
      system: EXTRACTOR_SYSTEM,
      output_config: {
        effort: effort.extract,
        format: zodOutputFormat(Extraction),
      },
      messages: [
        {
          role: 'user',
          content: [
            'Existing trip record:',
            renderTravelerState(userId),
            '',
            'Recent conversation:',
            transcript || '(none)',
            '',
            'NEWEST MESSAGE FROM THE TRAVELER:',
            newMessage,
            '',
            'Report only what this newest message changes.',
          ].join('\n'),
        },
      ],
    })

    if (!response.parsed_output) {
      log.warn('extraction returned no parsed output')
      return null
    }
    extraction = response.parsed_output
  } catch (error) {
    // Extraction failing must never block the reply - the traveler still gets
    // an answer, we just miss a state update.
    log.warn('extraction failed', describeError(error))
    return null
  }

  await applyExtraction(userId, extraction)
  return extraction
}

async function applyExtraction(userId: string, extraction: Extraction): Promise<void> {
  if (extraction.stay?.city) {
    const stay = upsertCurrentStay(userId, {
      city: extraction.stay.city,
      country: extraction.stay.country,
      lodgingName: extraction.stay.lodgingName,
      lodgingArea: extraction.stay.lodgingArea,
      arrivalDate: extraction.stay.arrivalDate,
      departureDate: extraction.stay.departureDate,
    })

    // Coordinates and timezone drive weather, quiet hours and search bias, so
    // resolve them as soon as a city is known.
    if (stay.latitude === null || stay.longitude === null || !stay.timezone) {
      const query = [stay.city, stay.country].filter(Boolean).join(', ')
      const geo = await geocode(query)
      if (geo) {
        setStayGeo(stay.id, {
          latitude: geo.latitude,
          longitude: geo.longitude,
          timezone: geo.timezone,
          region: geo.region,
          country: stay.country ?? geo.country,
          countryCode: geo.countryCode,
        })
        log.info(`located ${query} -> ${geo.latitude},${geo.longitude} (${geo.timezone})`)
      }
    }
  }

  for (const plan of extraction.newPlans) {
    if (!plan.title.trim()) continue
    addPlan(userId, plan)
  }

  const openIds = new Set(listOpenPlans(userId).map((p) => p.id))
  for (const update of extraction.planStatusUpdates) {
    if (!openIds.has(update.planId)) continue
    setPlanStatus(userId, update.planId, update.status)
  }

  for (const pref of extraction.newPreferences) {
    if (!pref.text.trim()) continue
    addPreference(userId, pref.kind, pref.text)
  }

  const stayId = currentStay(userId)?.id ?? null
  for (const entry of extraction.journalEntries) {
    if (!entry.text.trim()) continue
    addJournalEntry({
      userId,
      stayId,
      kind: 'note',
      text: entry.text.trim(),
      occurredOn: entry.occurredOn,
    })
  }
}
