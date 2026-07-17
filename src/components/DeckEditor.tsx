import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'

type GroupMode = 'tag' | 'type' | 'color' | 'mana' | 'zone'
type SortMode = 'name' | 'mana' | 'type'
type Zone = 'commander' | 'main' | 'maybeboard'
type ResolvedCard = { name: string; typeLine: string; oracleText?: string; manaValue: number; colorIdentity: string[] }

function primaryType(typeLine: string) {
  return ['Creature', 'Planeswalker', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Battle', 'Land']
    .find((type) => typeLine.includes(type)) ?? 'Other'
}

export function DeckEditor({ deck, thread, cards }: { deck: Doc<'decks'>; thread: Doc<'threads'>; cards: Doc<'deckCards'>[] }) {
  const [group, setGroup] = useState<GroupMode>('tag')
  const [sort, setSort] = useState<SortMode>('mana')
  const [query, setQuery] = useState('')
  const [zone, setZone] = useState<Zone>('main')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const upsert = useMutation(api.deckCards.upsert)
  const remove = useMutation(api.deckCards.remove)
  const updateTags = useMutation(api.deckCards.updateTags)

  const grouped = useMemo(() => {
    const keyFor = (card: Doc<'deckCards'>) => {
      if (group === 'tag') return card.tags[0] ?? 'Untagged'
      if (group === 'type') return primaryType(card.typeLine)
      if (group === 'color') return card.colorIdentity.length ? card.colorIdentity.join('') : 'Colorless'
      if (group === 'mana') return card.typeLine.includes('Land') ? 'Lands' : `${card.manaValue} mana`
      return card.zone === 'main' ? 'Main deck' : card.zone === 'commander' ? 'Commander' : 'Maybeboard'
    }
    const compare = (a: Doc<'deckCards'>, b: Doc<'deckCards'>) => {
      if (sort === 'mana') return a.manaValue - b.manaValue || a.name.localeCompare(b.name)
      if (sort === 'type') return a.typeLine.localeCompare(b.typeLine) || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    }
    const result = new Map<string, Doc<'deckCards'>[]>()
    for (const card of [...cards].sort(compare)) {
      const key = keyFor(card); result.set(key, [...(result.get(key) ?? []), card])
    }
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [cards, group, sort])

  const saveResolved = async (card: ResolvedCard, quantity: number, targetZone: Zone, tags: string[] = []) => {
    await upsert({
      deckId: deck._id, threadId: thread._id, actor: 'user', name: card.name, quantity,
      zone: targetZone, typeLine: card.typeLine, oracleText: card.oracleText,
      manaValue: card.manaValue, colorIdentity: card.colorIdentity, tags,
    })
  }

  const addCard = async () => {
    if (!query.trim()) return
    setBusy(true); setNotice('')
    const response = await fetch(`/api/cards/resolve?name=${encodeURIComponent(query)}`)
    const card = (await response.json()) as ResolvedCard & { error?: string }
    if (response.ok) { await saveResolved(card, 1, zone); setQuery('') }
    else setNotice(card.error ?? 'Card not found.')
    setBusy(false)
  }

  const importList = async () => {
    setBusy(true); setNotice('')
    const response = await fetch('/api/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decklist: importText }) })
    const result = await response.json() as { cards?: Array<ResolvedCard & { quantity: number }>; unresolved?: string[]; error?: string }
    if (!response.ok || !result.cards) setNotice(result.error ?? 'Import failed.')
    else {
      for (const card of result.cards) await saveResolved(card, card.quantity, 'main')
      setNotice(`Imported ${result.cards.length} cards${result.unresolved?.length ? `; unresolved: ${result.unresolved.join(', ')}` : '.'}`)
      setImportText(''); setImporting(false)
    }
    setBusy(false)
  }

  const deckTotal = cards.filter((card) => card.zone !== 'maybeboard').reduce((sum, card) => sum + card.quantity, 0)
  const lands = cards.filter((card) => card.zone !== 'maybeboard' && card.typeLine.includes('Land')).reduce((sum, card) => sum + card.quantity, 0)

  return <aside className="deck-pane">
    <header className="pane-header"><div><p className="eyebrow">LIVE DECK</p><h2>{deck.name}</h2></div><span className="deck-count">{deckTotal} / 100</span></header>
    <div className="deck-stats"><span><b>{cards.length}</b> unique</span><span><b>{lands}</b> lands</span><span><b>{cards.filter((c) => c.tags.includes('Ramp')).length}</b> ramp</span></div>
    <div className="card-add-row">
      <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCard() }} placeholder="Add a card…" />
      <select value={zone} onChange={(e) => setZone(e.target.value as Zone)}><option value="main">Main</option><option value="commander">Commander</option><option value="maybeboard">Maybe</option></select>
      <button onClick={() => void addCard()} disabled={busy}>+</button>
    </div>
    <div className="deck-toolbar">
      <label>Group <select value={group} onChange={(e) => setGroup(e.target.value as GroupMode)}><option value="tag">Tag</option><option value="type">Type</option><option value="color">Color</option><option value="mana">Mana value</option><option value="zone">Board</option></select></label>
      <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}><option value="mana">Mana value</option><option value="name">Name</option><option value="type">Type</option></select></label>
      <button className="text-button" onClick={() => setImporting(!importing)}>Import</button>
    </div>
    {importing && <div className="import-box"><textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'1 Sol Ring\n1 Arcane Signet\n36 Island'} rows={7} /><button className="primary-button" onClick={() => void importList()} disabled={busy}>Import list</button></div>}
    {notice && <div className="notice-banner">{notice}</div>}
    <div className="deck-groups">
      {grouped.map(([label, groupCards]) => <section className="card-group" key={label}>
        <header><h3>{label}</h3><span>{groupCards.reduce((sum, card) => sum + card.quantity, 0)}</span></header>
        {groupCards.map((card) => <div className="card-row" key={card._id} title={card.oracleText}>
          <input aria-label={`${card.name} quantity`} type="number" min="1" value={card.quantity} onChange={(e) => void upsert({
            deckId: deck._id, threadId: thread._id, actor: 'user', name: card.name,
            quantity: Number(e.target.value), zone: card.zone, typeLine: card.typeLine,
            oracleText: card.oracleText, manaValue: card.manaValue, colorIdentity: card.colorIdentity, tags: card.tags,
          })} />
          <div><strong>{card.name}</strong><small>{card.typeLine} · {card.manaValue}</small></div>
          <input className="tag-input" defaultValue={card.tags.join(', ')} placeholder="tags" onBlur={(e) => void updateTags({ cardId: card._id, tags: e.target.value.split(',') })} />
          <button aria-label={`Remove ${card.name}`} onClick={() => void remove({ cardId: card._id, threadId: thread._id, actor: 'user' })}>×</button>
        </div>)}
      </section>)}
      {!cards.length && <div className="deck-empty">Add cards individually or import a text list. The assistant can edit this list too.</div>}
    </div>
  </aside>
}
