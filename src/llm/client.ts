import Anthropic from '@anthropic-ai/sdk'

/**
 * Zero-arg construction on purpose: the SDK resolves ANTHROPIC_API_KEY, then
 * ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile. Passing the key
 * explicitly would break the profile path for no benefit.
 */
export const anthropic = new Anthropic()

export class RefusalError extends Error {
  constructor(
    readonly category: string | null,
    readonly explanation: string | null,
  ) {
    super(`Model declined the request (${category ?? 'uncategorised'})`)
    this.name = 'RefusalError'
  }
}
