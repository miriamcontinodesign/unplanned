import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { llm, withModelFallback } from './client.js'
import { effort, reasoningParams } from '../config.js'
import { EXTRACTOR_SYSTEM } from './prompts.js'
import { renderTravelerState } from './state.js'
import { geocode } from '../services/geocode.js'
import { addPreference, setStayGeo, upsertCurrentStay } from '../db/repo.js'
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
      budgetLevel: z.enum(['shoestring', 'moderate', 'comfortable', 'luxury']).nullable(),
      partySize: z.number().int().nullable(),
    })
    .nullable(),
  newPreferences: z.array(
    z.object({
      kind: z.enum(['like', 'dislike', 'constraint']),
      text: z.string(),
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
    const response = await withModelFallback((model) =>
      llm().chat.completions.parse({
        model,
        max_tokens: 8000,
        response_format: zodResponseFormat(Extraction, 'extraction'),
        ...reasoningParams(effort.extract),
        messages: [
          { role: 'system', content: EXTRACTOR_SYSTEM },
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
      }),
    )

    const parsed = response.choices[0]?.message.parsed
    if (!parsed) {
      log.warn('extraction returned no parsed output')
      return null
    }
    extraction = parsed
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
      ...(extraction.stay.budgetLevel ? { budgetLevel: extraction.stay.budgetLevel } : {}),
      ...(extraction.stay.partySize ? { partySize: extraction.stay.partySize } : {}),
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

  for (const pref of extraction.newPreferences) {
    if (!pref.text.trim()) continue
    addPreference(userId, pref.kind, pref.text)
  }
}
