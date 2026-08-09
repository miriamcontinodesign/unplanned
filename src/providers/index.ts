import { config } from '../config.js'
import { logger } from '../util/log.js'
import { FixtureProvider } from './fixtures.js'
import { viatorFromConfig } from './viator.js'
import type { ActivityProvider } from './types.js'

const log = logger('providers')

let provider: ActivityProvider | null = null

export function activityProvider(): ActivityProvider {
  if (provider) return provider

  if (config.activityProvider === 'viator') {
    provider = viatorFromConfig()
    log.info(
      `activity provider: viator (${config.viator.sandbox ? 'sandbox' : 'production'}, ${provider.bookingMode})`,
    )
  } else {
    provider = new FixtureProvider()
    log.info('activity provider: sample catalogue (no credentials required)')
  }

  return provider
}

export * from './types.js'
