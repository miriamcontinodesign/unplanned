type Level = 'debug' | 'info' | 'warn' | 'error'

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = order[(process.env.ROADIO_LOG_LEVEL as Level) ?? 'info'] ?? order.info

function emit(level: Level, scope: string, message: string, extra?: unknown) {
  if (order[level] < threshold) return
  const stamp = new Date().toISOString()
  const line = `${stamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`
  if (extra === undefined) {
    console.log(line)
  } else {
    console.log(line, extra)
  }
}

export function logger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => emit('debug', scope, message, extra),
    info: (message: string, extra?: unknown) => emit('info', scope, message, extra),
    warn: (message: string, extra?: unknown) => emit('warn', scope, message, extra),
    error: (message: string, extra?: unknown) => emit('error', scope, message, extra),
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
