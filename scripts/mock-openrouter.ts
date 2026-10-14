/**
 * Local stand-in for OpenRouter, for running the app without a real
 * OPENROUTER_API_KEY. Speaks just enough of the OpenAI chat.completions
 * wire shape for both LLM passes:
 *  - extraction: a structured-output call (response_format: json_schema) -
 *    always answers "nothing new" so onboarding/preferences stay a no-op.
 *  - reply: a plain/tool-capable call - answers with a canned text message
 *    and never emits a tool call, so the agent loop terminates in one turn.
 *
 * Point ROADIO_OPENROUTER_BASE_URL at this server's /v1 and set
 * OPENROUTER_API_KEY to any non-empty placeholder value.
 */
import { createServer } from 'node:http'

const port = Number(process.env.MOCK_OPENROUTER_PORT || 8788)

function respondJson(res: import('node:http').ServerResponse, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(text)
}

const CITIES: Record<string, string> = {
  lisbon: 'Portugal',
  tokyo: 'Japan',
  'mexico city': 'Mexico',
  'new york': 'United States',
  brooklyn: 'United States',
  paris: 'France',
  london: 'United Kingdom',
}

/** Picks a known city out of the newest traveler message; otherwise "nothing new". */
function mockExtraction(messages: { content?: unknown }[]) {
  const prompt = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
  const newest = (prompt.split('NEWEST MESSAGE FROM THE TRAVELER:')[1] ?? '').toLowerCase()
  const city = Object.keys(CITIES).find((name) => newest.includes(name))
  if (!city) return { stay: null, newPreferences: [] }
  return {
    stay: {
      city: city.replace(/\b\w/g, (c) => c.toUpperCase()),
      country: CITIES[city],
      lodgingName: null,
      lodgingArea: null,
      budgetLevel: null,
      partySize: null,
    },
    newPreferences: newest.includes('food') ? [{ kind: 'like', text: 'food' }] : [],
  }
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('mock-openrouter: not found')
    return
  }

  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    let payload: { response_format?: { type?: string }; messages?: { content?: unknown }[] } = {}
    try {
      payload = JSON.parse(raw)
    } catch {
      // fall through with an empty payload
    }

    const isStructured = payload.response_format?.type === 'json_schema'
    const content = isStructured
      ? JSON.stringify(mockExtraction(payload.messages ?? []))
      : "Mock reply (no OPENROUTER_API_KEY set) - I can't actually think, but the app is wired up correctly."

    respondJson(res, {
      id: 'mock-completion',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock/local',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content, refusal: null, tool_calls: [] },
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  })
})

server.listen(port, () => {
  console.log(`[mock-openrouter] listening on http://127.0.0.1:${port}/v1`)
})
