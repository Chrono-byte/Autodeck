import { chat, maxIterations, toServerSentEventsResponse, type UIMessage } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { createFileRoute } from '@tanstack/react-router'
import { analyzeDeckTool, comprehensiveRulesTool, getCardTool, searchCardsTool } from '../ai/tools.server'
import { SYSTEM_PROMPT } from '../ai/system-prompt'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: UIMessage[] }
        if (!Array.isArray(body.messages)) {
          return Response.json({ error: 'A messages array is required.' }, { status: 400 })
        }

        const baseURL = (process.env.LM_STUDIO_URL ?? 'http://127.0.0.1:1234')
          .replace(/\/$/, '')
          .replace(/\/v1$/, '')

        const stream = chat({
          adapter: openaiCompatibleText(
            process.env.LM_STUDIO_MODEL ?? 'google/gemma-4-12b-qat',
            {
              name: 'lm-studio',
              baseURL: `${baseURL}/v1`,
              // The adapter requires a non-empty value; LM Studio does not authenticate it.
              apiKey: 'not-needed',
              api: 'chat-completions',
            },
          ),
          messages: body.messages,
          systemPrompts: [SYSTEM_PROMPT],
          tools: [
            getCardTool,
            searchCardsTool,
            analyzeDeckTool,
            comprehensiveRulesTool,
          ],
          agentLoopStrategy: maxIterations(12),
        })

        return toServerSentEventsResponse(stream)
      },
    },
  },
})
