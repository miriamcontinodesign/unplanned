import OpenAI from 'openai'
import { config } from '../config.js'

let client: OpenAI | null = null

/**
 * The model client, built on first use rather than at import.
 *
 * Constructing eagerly would take down the web app and the smoke test, which
 * are both meant to run with no credentials at all: the OpenAI SDK throws from
 * its constructor when the key is missing. Deferring keeps the failure at the
 * call that actually needs a key.
 *
 * OpenRouter speaks the OpenAI wire protocol, so this is the OpenAI SDK pointed
 * at their base URL - there is no Anthropic-format endpoint on OpenRouter, which
 * is why the whole LLM layer is OpenAI-shaped.
 */
export function llm(): OpenAI {
  if (!client) {
    if (!config.openRouterApiKey) {
      // The SDK's own message names OPENAI_API_KEY, which is the wrong variable
      // for this app and sends people looking in the wrong place.
      throw new Error(
        'OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/keys and put it in .env.',
      )
    }
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.openRouterApiKey,
    })
  }
  return client
}

/** Thrown when the model declines rather than answers. */
export class RefusalError extends Error {
  constructor(
    readonly category: string | null,
    readonly explanation: string | null,
  ) {
    super(`Model declined the request (${category ?? 'uncategorised'})`)
    this.name = 'RefusalError'
  }
}

/**
 * OpenRouter reports upstream provider failures in the body of an HTTP 200
 * rather than as a transport error, so every call site has to look for it or a
 * provider outage reads as an empty reply.
 */
export function throwOnRouterError(response: unknown): void {
  const error = (response as { error?: { message?: string; code?: number } }).error
  if (error) {
    throw new Error(`OpenRouter: ${error.message ?? 'unknown error'} (code ${error.code ?? '?'})`)
  }
}
