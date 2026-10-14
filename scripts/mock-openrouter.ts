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

type Message = { role?: string; content?: unknown }
const text = (message: Message | undefined): string =>
  typeof message?.content === 'string' ? message.content : ''

function cityIn(messages: Message[]): string | null {
  // Newest traveler message first, then the rest (the system prompt carries the trip record).
  const ordered = [...messages].reverse().sort((a, b) => Number(b.role === 'user') - Number(a.role === 'user'))
  for (const message of ordered) {
    const found = Object.keys(CITIES).find((name) => text(message).toLowerCase().includes(name))
    if (found) return found.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return null
}

/** What a model with the search tool would do: search for the city once, then recommend the top three. */
function mockToolTurn(messages: Message[], hasSearchTool: boolean) {
  const last = messages.at(-1)
  if (last?.role === 'tool') {
    const titles = [...text(last).matchAll(/^\d+\. (.+?) \[product \S+\]$/gm)].map((m) => m[1]).slice(0, 3)
    if (titles.length === 0) return { content: 'I could not find anything bookable for that right now.' }
    return { content: `Here are three good options for tonight:\n\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}` }
  }

  const city = cityIn(messages)
  if (!hasSearchTool || !city) return null
  const latestAsk = text([...messages].reverse().find((m) => m.role === 'user')).toLowerCase()
  const topic = latestAsk.includes('food') || latestAsk.includes('eat') ? 'food tours' : 'things to do'
  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  return {
    content: null,
    tool_calls: [
      {
        id: 'call_mock_search',
        type: 'function',
        function: {
          name: 'search_experiences',
          arguments: JSON.stringify({ searchTerm: `${topic} in ${city}`, startDate: day, endDate: day }),
        },
      },
    ],
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
    let payload: {
      response_format?: { type?: string; json_schema?: { name?: string } }
      messages?: Message[]
      tools?: { function?: { name?: string } }[]
    } = {}
    try {
      payload = JSON.parse(raw)
    } catch {
      // fall through with an empty payload
    }

    const isStructured = payload.response_format?.type === 'json_schema'
    const wantsSuggestions = payload.response_format?.json_schema?.name === 'suggestions'
    const toolTurn = isStructured
      ? null
      : mockToolTurn(payload.messages ?? [], Boolean(payload.tools?.some((t) => t.function?.name === 'search_experiences')))
    const content = wantsSuggestions
      ? JSON.stringify({ suggestions: ['Something cheaper', 'Anything indoors?', 'What about tomorrow?'] })
      : isStructured
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
          finish_reason: toolTurn?.tool_calls ? 'tool_calls' : 'stop',
          message: {
            role: 'assistant',
            content: toolTurn ? toolTurn.content : content,
            refusal: null,
            tool_calls: toolTurn?.tool_calls ?? [],
          },
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  })
})

server.listen(port, () => {
  console.log(`[mock-openrouter] listening on http://127.0.0.1:${port}/v1`)
})
