import { logger } from '../util/log.js'
import { config } from '../config.js'
import { FixtureProvider } from './fixtures.js'
import { ViatorProvider } from './viator.js'
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
    provider = config.viatorMock ? new FixtureProvider() : new ViatorProvider()
    log.info(config.viatorMock ? 'activity provider: sample catalogue' : 'activity provider: live Viator MCP')
  }
  return provider
}

export * from './types.js'
