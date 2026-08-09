import { llm, throwOnRouterError } from './client.js'
import { config, effort, reasoningParams } from '../config.js'
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
    const response = await llm().chat.completions.create({
      model: config.model,
      max_tokens: 1000,
      ...reasoningParams(effort.caption),
      messages: [
        { role: 'system', content: CAPTION_SYSTEM },
        {
          role: 'user',
          content: [
            {
              // OpenAI-shaped vision input takes a data URL rather than a
              // separate media type and payload.
              type: 'image_url',
              image_url: {
                url: `data:${mediaTypeFor(filePath)};base64,${bytes.toString('base64')}`,
              },
            },
            { type: 'text', text: `Context: ${context}` },
          ],
        },
      ],
    })
    throwOnRouterError(response)

    if (response.choices[0]?.message.refusal) return null
    return collectText(response) || null
  } catch (error) {
    log.warn('captioning failed', describeError(error))
    return null
  }
}
