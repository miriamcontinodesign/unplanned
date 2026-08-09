import { anthropic } from './client.js'
import { config, effort } from '../config.js'
import { CAPTION_SYSTEM } from './prompts.js'
import { collectText } from './agent.js'
import { describeError, logger } from '../util/log.js'

const log = logger('caption')

type SupportedMedia = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function mediaTypeFor(filePath: string): SupportedMedia {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/** One-line journal caption for a photo. Returns null if the model can't help. */
export async function captionPhoto(
  bytes: Buffer,
  filePath: string,
  context: string,
): Promise<string | null> {
  try {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 1000,
      system: CAPTION_SYSTEM,
      output_config: { effort: effort.caption },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaTypeFor(filePath),
                data: bytes.toString('base64'),
              },
            },
            { type: 'text', text: `Context: ${context}` },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') return null
    return collectText(response) || null
  } catch (error) {
    log.warn('captioning failed', describeError(error))
    return null
  }
}
