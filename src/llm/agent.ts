import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, RefusalError } from './client.js'
import { config } from '../config.js'
import { logger } from '../util/log.js'

const log = logger('agent')

export interface AgentTool {
  definition: Anthropic.Messages.ToolUnion
  /** Omitted for server-side tools such as web_search, which Anthropic executes. */
  run?: (input: Record<string, unknown>) => Promise<string>
}

export interface AgentRunOptions {
  /** Split into blocks so a cache breakpoint can sit on the stable prefix. */
  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools: AgentTool[]
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxIterations?: number
  maxTokens?: number
}

export interface AgentResult {
  finalMessage: Anthropic.Message
  text: string
  toolCalls: string[]
}

/**
 * A hand-written tool-use loop rather than the SDK's beta tool runner.
 *
 * Two reasons: this process is long-running and we would rather not depend on a
 * beta surface, and mixing the server-side web_search tool in means `pause_turn`
 * has to be resumed manually regardless - which is most of what the runner would
 * have done for us here.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const byName = new Map<string, AgentTool>()
  for (const tool of options.tools) {
    byName.set((tool.definition as { name: string }).name, tool)
  }

  const messages: Anthropic.MessageParam[] = [...options.messages]
  const definitions = options.tools.map((t) => t.definition)
  const maxIterations = options.maxIterations ?? 8
  const toolCalls: string[] = []

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: options.maxTokens ?? 16000,
      system: options.system,
      messages,
      tools: definitions,
      thinking: { type: 'adaptive' },
      output_config: { effort: options.effort ?? 'medium' },
    })

    if (response.stop_reason === 'refusal') {
      const details = (response as { stop_details?: { category?: string; explanation?: string } })
        .stop_details
      throw new RefusalError(details?.category ?? null, details?.explanation ?? null)
    }

    messages.push({ role: 'assistant', content: response.content })

    // A server-side tool hit its iteration limit; re-send to let it continue.
    if (response.stop_reason === 'pause_turn') {
      log.debug('resuming paused turn')
      continue
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )

    if (toolUses.length === 0) {
      return { finalMessage: response, text: collectText(response), toolCalls }
    }

    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        toolCalls.push(use.name)
        const tool = byName.get(use.name)
        if (!tool?.run) {
          return {
            type: 'tool_result',
            tool_use_id: use.id,
            content: `No handler registered for tool "${use.name}".`,
            is_error: true,
          }
        }
        try {
          const output = await tool.run((use.input ?? {}) as Record<string, unknown>)
          return { type: 'tool_result', tool_use_id: use.id, content: output }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log.warn(`tool ${use.name} failed`, message)
          return {
            type: 'tool_result',
            tool_use_id: use.id,
            content: `Tool failed: ${message}`,
            is_error: true,
          }
        }
      }),
    )

    messages.push({ role: 'user', content: results })
  }

  throw new Error(`Agent exceeded ${maxIterations} iterations without finishing.`)
}

export function collectText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}
