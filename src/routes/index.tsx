import { useState } from 'react'
import type { ToolCallPart, ToolResultPart, UIMessage } from '@tanstack/ai'
import { createFileRoute } from '@tanstack/react-router'
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'

export const Route = createFileRoute('/')({ component: Home })

const starters = [
  'Look up rule 704.5f and explain it plainly.',
  'How do replacement effects interact when more than one applies?',
  "Verify Muldrotha, the Gravetide's current Oracle text, then help me build around it at a focused casual power level.",
]

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
    .join('')
}

const toolLabels: Record<string, string> = {
  get_card_text: 'Checking card text',
  search_cards: 'Searching cards',
  analyze_decklist: 'Analyzing decklist',
  lookup_comprehensive_rules: 'Consulting comprehensive rules',
}

function formatToolValue(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function toolResultText(result?: ToolResultPart) {
  if (!result) return ''
  if (typeof result.content === 'string') return formatToolValue(result.content)
  return result.content
    .map((part) => ('text' in part ? part.text : formatToolValue(part)))
    .join('\n')
}

function ToolActivity({ call, result }: { call: ToolCallPart; result?: ToolResultPart }) {
  const failed = call.state === 'error' || result?.state === 'error'
  const complete = call.state === 'complete' || result?.state === 'complete'
  const status = failed ? 'Failed' : complete ? 'Complete' : 'In progress'
  const input = call.input ?? call.arguments
  const output = result?.error || toolResultText(result)

  return (
    <details className={`tool-activity ${failed ? 'failed' : complete ? 'complete' : 'active'}`}>
      <summary>
        <span className="tool-icon" aria-hidden="true">⌁</span>
        <span className="tool-title">{toolLabels[call.name] ?? call.name.replaceAll('_', ' ')}</span>
        <span className="tool-status">{status}</span>
      </summary>
      <div className="tool-details">
        <div>
          <span>Input</span>
          <pre>{formatToolValue(input)}</pre>
        </div>
        {output && (
          <div>
            <span>{failed ? 'Error' : 'Result'}</span>
            <pre>{output}</pre>
          </div>
        )}
      </div>
    </details>
  )
}

function Home() {
  const [input, setInput] = useState('')
  const { messages, sendMessage, isLoading, error } = useChat({
    connection: fetchServerSentEvents('/api/chat'),
  })

  const toolResults = new Map(
    messages.flatMap((message) =>
      message.parts
        .filter((part): part is ToolResultPart => part.type === 'tool-result')
        .map((part) => [part.toolCallId, part] as const),
    ),
  )
  const visibleToolCallIds = new Set(
    messages.flatMap((message) =>
      message.parts
        .filter((part): part is ToolCallPart => part.type === 'tool-call')
        .map((part) => part.id),
    ),
  )

  const submit = (text: string) => {
    const content = text.trim()
    if (!content || isLoading) return
    sendMessage({ content })
    setInput('')
  }

  return (
    <main className="app-shell">
      <header className="brand-row">
        <div className="brand-mark" aria-hidden="true">A</div>
        <div>
          <div className="eyebrow">COMMANDER RESEARCH AGENT</div>
          <div className="brand-name">Autodekt</div>
        </div>
        <div className="status"><span /> Local Gemma + Scryfall + CR 2026.06.19</div>
      </header>

      <section className="workspace">
        <aside className="brief-card">
          <p className="eyebrow">DECK BRIEF</p>
          <h2>Build with intent.</h2>
          <p className="muted">The agent will clarify these before it commits to a list.</p>
          <dl>
            <div><dt>Commander</dt><dd>Not chosen</dd></div>
            <div><dt>Power</dt><dd>Focused casual</dd></div>
            <div><dt>Budget</dt><dd>Open</dd></div>
            <div><dt>Plan</dt><dd>To be discovered</dd></div>
          </dl>
          <div className="capabilities">
            <span>Deck tech synthesis</span>
            <span>Oracle card search</span>
            <span>Ratio analysis</span>
            <span>Cut recommendations</span>
            <span>Comprehensive rules</span>
          </div>
        </aside>

        <section className="chat-card">
          <div className="chat-scroll">
            {messages.length === 0 ? (
              <div className="welcome">
                <p className="eyebrow">NEW DECK STUDY</p>
                <h1>What are we building?</h1>
                <p>Bring a commander, a theme, or a messy list. I’ll research the field, inspect the cards, and help shape a coherent hundred.</p>
                <div className="starter-grid">
                  {starters.map((starter) => (
                    <button key={starter} onClick={() => submit(starter)}>{starter}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="messages">
                {messages.map((message) => {
                  const text = messageText(message)
                  const hasVisibleParts = message.parts.some(
                    (part) => part.type === 'tool-call'
                      || (part.type === 'tool-result' && !visibleToolCallIds.has(part.toolCallId)),
                  )
                  if (!text && !hasVisibleParts) return null
                  return (
                    <article key={message.id} className={`message ${message.role}`}>
                      <div className="message-label">{message.role === 'user' ? 'You' : 'Autodekt'}</div>
                      <div className="message-body">
                        {message.parts.map((part, index) => {
                          if (part.type === 'text') {
                            return <span key={index} className="message-text">{part.content}</span>
                          }
                          if (part.type === 'tool-call') {
                            return <ToolActivity key={part.id} call={part} result={toolResults.get(part.id)} />
                          }
                          if (part.type === 'tool-result' && !visibleToolCallIds.has(part.toolCallId)) {
                            return (
                              <details key={part.toolCallId} className={part.state === 'error' ? 'tool-activity failed' : 'tool-activity complete'}>
                                <summary>
                                  <span className="tool-icon" aria-hidden="true">⌁</span>
                                  <span className="tool-title">Tool result</span>
                                  <span className="tool-status">{part.state === 'error' ? 'Failed' : 'Complete'}</span>
                                </summary>
                                <div className="tool-details"><pre>{part.error || toolResultText(part)}</pre></div>
                              </details>
                            )
                          }
                          return null
                        })}
                      </div>
                    </article>
                  )
                })}
                {isLoading && <div className="thinking"><i /><i /><i /> Researching</div>}
              </div>
            )}
          </div>

          {error && <div className="error-banner">{error.message}</div>}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault()
              submit(input)
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit(input)
                }
              }}
              placeholder="Name a commander, describe a strategy, or paste a decklist…"
              rows={3}
              disabled={isLoading}
            />
            <div className="composer-footer">
              <span>Enter to send · Shift + Enter for a new line</span>
              <button type="submit" disabled={!input.trim() || isLoading}>Send inquiry →</button>
            </div>
          </form>
        </section>
      </section>
    </main>
  )
}
