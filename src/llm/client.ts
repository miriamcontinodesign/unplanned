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
      baseURL: config.openRouterBaseUrl,
      apiKey: config.openRouterApiKey,
      // With fallbacks, failing over beats waiting out the SDK's backoff on a dead model.
      ...(config.fallbackModels.length > 0 ? { maxRetries: 0 } : {}),
    })
  }
  return client
}

/** How long a rate-limited model is skipped before it is tried again. */
const COOLDOWN_MS = 60_000
const cooldownUntil = new Map<string, number>()

/** Errors another model could plausibly get past, as opposed to a bug in our request. */
function isFailoverError(error: unknown): boolean {
  const status = (error as { status?: number }).status
  if (typeof status === 'number') return status === 429 || status === 402 || status === 408 || status >= 404
  // Connection failures and errors reported inside a 200 body (throwOnRouterError).
  return error instanceof OpenAI.APIConnectionError || (error instanceof Error && error.message.startsWith('OpenRouter:'))
}

/**
 * Runs `call` against `ROADIO_MODEL`, then each of `ROADIO_FALLBACK_MODELS` until one
 * succeeds. Only failover-worthy errors (rate limit, out of credit, provider down, model
 * unavailable) move on to the next model; anything else is thrown straight away.
 * Rate-limited models are skipped for a minute so every turn doesn't pay for a dead call.
 */
export async function withModelFallback<T extends object>(
  call: (model: string) => Promise<T>,
): Promise<T> {
  const all = [config.model, ...config.fallbackModels.filter((slug) => slug !== config.model)]
  const now = Date.now()
  const ready = all.filter((slug) => (cooldownUntil.get(slug) ?? 0) <= now)
  const candidates = ready.length > 0 ? ready : all

  let lastError: unknown
  for (const model of candidates) {
    try {
      const response = await call(model)
      throwOnRouterError(response)
      return response
    } catch (error) {
      if (!isFailoverError(error)) throw error
      lastError = error
      if ((error as { status?: number }).status === 429) cooldownUntil.set(model, Date.now() + COOLDOWN_MS)
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[llm] ${model} failed (${reason}); ${model === candidates.at(-1) ? 'no more models' : 'trying next'}`)
    }
  }
  throw lastError
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
