import { logger } from '../util/log.js'
import { FixtureProvider } from './fixtures.js'
import type { ActivityProvider } from './types.js'

const log = logger('providers')

let provider: ActivityProvider | null = null

/**
 * The activity catalogue.
 *
 * Only the sample provider ships today - no third-party integrations. The
 * `ActivityProvider` interface is what makes that a swap rather than a rewrite:
 * a real supplier drops in behind it. A Viator client written against their
 * documented shapes lives in git history at 02e9c06 if it is wanted back, but
 * it was never verifiable without a key, so it is not carried as dead code.
 */
export function activityProvider(): ActivityProvider {
  if (!provider) {
    provider = new FixtureProvider()
    log.info('activity provider: sample catalogue (no credentials required)')
  }
  return provider
}

export * from './types.js'
