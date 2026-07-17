import { useEffect, useMemo, useState } from 'react'
import type { UIMessage } from '@tanstack/ai'
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import {
  editActiveDeckClientTool,
  getActiveDeckClientTool,
  type DeckToolContext,
} from '../ai/deck-tools'

type ResolvedCard = {
  name: string; typeLine: string; oracleText?: string; manaValue: number; colorIdentity: string[]
}

function textOf(message: UIMessage) {
  return message.parts.filter((part) => part.type === 'text').map((part) => part.content).join('')
}

export function DeckChat({
  deck, thread, cards,
}: {
  deck: Doc<'decks'>; thread: Doc<'threads'>; cards: Doc<'deckCards'>[]
}) {
  const [input, setInput] = useState('')
  const saveMessages = useMutation(api.threads.saveMessages)
  const upsertCard = useMutation(api.deckCards.upsert)
  const removeCard = useMutation(api.deckCards.remove)

  const context = useMemo<DeckToolContext>(() => ({
    readDeck: () => ({
      deck: { name: deck.name, commanderName: deck.commanderName, colorIdentity: deck.colorIdentity },
      cards: cards.map(({ name, quantity, zone, typeLine, oracleText, manaValue, tags }) => ({
        name, quantity, zone, typeLine, oracleText, manaValue, tags,
      })),
    }),
    editDeck: async (edit) => {
      if (edit.action === 'remove') {
        const card = cards.find((item) => item.name.toLocaleLowerCase() === edit.cardName.toLocaleLowerCase())
        if (!card) return { success: false, message: `${edit.cardName} is not in the active deck.` }
        await removeCard({ cardId: card._id, threadId: thread._id, actor: 'assistant' })
        return { success: true, message: `Removed ${card.name}.` }
      }
      const response = await fetch(`/api/cards/resolve?name=${encodeURIComponent(edit.cardName)}`)
      const resolved = (await response.json()) as ResolvedCard & { error?: string }
      if (!response.ok) return { success: false, message: resolved.error ?? 'Card lookup failed.' }
      await upsertCard({
        deckId: deck._id, threadId: thread._id, actor: 'assistant',
        name: resolved.name, quantity: edit.quantity, zone: edit.zone,
        typeLine: resolved.typeLine, oracleText: resolved.oracleText,
        manaValue: resolved.manaValue, colorIdentity: resolved.colorIdentity, tags: edit.tags,
      })
      return { success: true, message: `Saved ${edit.quantity} × ${resolved.name} to ${edit.zone}.` }
    },
  }), [cards, deck, removeCard, thread._id, upsertCard])

  const chat = useChat({
    id: String(thread._id),
    connection: fetchServerSentEvents('/api/chat'),
    initialMessages: (thread.messageState ?? []) as never[],
    tools: [getActiveDeckClientTool, editActiveDeckClientTool],
    context,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Convex values are JSON-like; normalize Date instances and omit undefined fields.
      const messages = JSON.parse(JSON.stringify(chat.messages)) as unknown[]
      void saveMessages({ threadId: thread._id, messages })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [chat.messages, saveMessages, thread._id])

  const submit = () => {
    const content = input.trim()
    if (!content || chat.isLoading) return
    chat.sendMessage({ content }); setInput('')
  }

  return (
    <section className="chat-pane">
      <header className="pane-header">
        <div><p className="eyebrow">THREAD</p><h2>{thread.title}</h2></div>
        <span className="local-model-badge">● Local Gemma</span>
      </header>
      <div className="chat-messages">
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            <p className="eyebrow">DECK STUDY</p>
            <h1>How should we shape {deck.name}?</h1>
            <p>I can inspect the live deck, verify cards, research its structure, and edit the list with you.</p>
          </div>
        )}
        {chat.messages.map((message) => {
          const text = textOf(message)
          const toolCalls = message.parts.filter((part) => part.type === 'tool-call')
          if (!text && !toolCalls.length) return null
          return <article key={message.id} className={`message ${message.role}`}>
            <div className="avatar">{message.role === 'user' ? 'Y' : 'A'}</div>
            <div className="message-content">
              <strong>{message.role === 'user' ? 'You' : 'Autodekt'}</strong>
              {text && <div className="message-body">{text}</div>}
              {toolCalls.map((part) => <div className="tool-chip" key={part.id}>↳ {part.name.replaceAll('_', ' ')}</div>)}
            </div>
          </article>
        })}
        {chat.isLoading && <div className="thinking"><i /><i /><i /> Working through the deck</div>}
      </div>
      {chat.error && <div className="error-banner">{chat.error.message}</div>}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }} placeholder={`Ask about ${deck.commanderName ?? deck.name}, request cuts, or tell me to edit the list…`} rows={3} />
        <div><span>Deck-aware · card text verified through Scryfall</span><button disabled={!input.trim() || chat.isLoading}>Send ↑</button></div>
      </form>
    </section>
  )
}
