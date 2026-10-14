import type OpenAI from 'openai'
import { llm, RefusalError, withModelFallback } from './client.js'
import { reasoningParams, type EffortLevel } from '../config.js'
import { logger } from '../util/log.js'

const log = logger('agent')

export interface AgentTool {
  /** Narrower than ChatCompletionTool, which also covers provider custom tools. */
  definition: OpenAI.Chat.Completions.ChatCompletionFunctionTool
  run: (input: Record<string, unknown>) => Promise<string>
}

export interface AgentRunOptions {
  /** Prepended as system turns, most stable first. */
  system: string[]
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  tools: AgentTool[]
  effort?: EffortLevel
  maxIterations?: number
  maxTokens?: number
}

export interface AgentResult {
  text: string
  toolCalls: string[]
}

/**
 * A hand-written tool-use loop rather than an SDK helper, so the process keeps
 * one obvious place to bound iterations and log what the model reached for.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const byName = new Map<string, AgentTool>()
  for (const tool of options.tools) {
    byName.set(tool.definition.function.name, tool)
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...options.system.map(
      (text): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
        role: 'system',
        content: text,
      }),
    ),
    ...options.messages,
  ]
  const definitions = options.tools.map((t) => t.definition)
  const maxIterations = options.maxIterations ?? 8
  const toolCalls: string[] = []

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await withModelFallback((model) =>
      llm().chat.completions.create({
        model,
        max_tokens: options.maxTokens ?? 16000,
        messages,
        tools: definitions,
        ...reasoningParams(options.effort ?? 'medium'),
      }),
    )

    const choice = response.choices[0]
    if (!choice) throw new Error('OpenRouter returned no choices.')

    // A structured refusal is a normal response, not a transport failure.
    if (choice.message.refusal) {
      throw new RefusalError(null, choice.message.refusal)
    }

    messages.push(choice.message)

    const requested = choice.message.tool_calls ?? []
    if (requested.length === 0) {
      return { text: choice.message.content?.trim() ?? '', toolCalls }
    }

    const results = await Promise.all(
      requested.map(
        async (call): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> => {
          // Only function calls carry a name to dispatch on; anything else is a
          // provider extension we did not ask for.
          if (call.type !== 'function') {
            return {
              role: 'tool',
              tool_call_id: call.id,
              content: `Unsupported tool call type "${call.type}".`,
            }
          }

          toolCalls.push(call.function.name)
          const tool = byName.get(call.function.name)
          if (!tool) {
            return {
              role: 'tool',
              tool_call_id: call.id,
              content: `No handler registered for tool "${call.function.name}".`,
            }
          }

          // Arguments arrive as a JSON string, and a cheap model will sometimes
          // emit something that does not parse. Report it back rather than
          // throwing, so the model gets a chance to correct itself.
          let input: Record<string, unknown>
          try {
            input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
          } catch {
            log.warn(`tool ${call.function.name} sent unparseable arguments`)
            return {
              role: 'tool',
              tool_call_id: call.id,
              content: 'Arguments were not valid JSON. Call the tool again with valid JSON.',
            }
          }

          try {
            return { role: 'tool', tool_call_id: call.id, content: await tool.run(input) }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            log.warn(`tool ${call.function.name} failed`, message)
            return { role: 'tool', tool_call_id: call.id, content: `Tool failed: ${message}` }
          }
        },
      ),
    )

    messages.push(...results)
  }

  throw new Error(`Agent exceeded ${maxIterations} iterations without finishing.`)
}

/** Text of a single-shot completion, for the call sites that use no tools. */
export function collectText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  return response.choices[0]?.message.content?.trim() ?? ''
}
