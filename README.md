# Autodekt

An agentic Magic: The Gathering Commander deck research and tuning workspace built with TanStack Start and TanStack AI.

## First run

```bash
pnpm install
npx convex dev --once
```

The Convex command creates `.env.local`, starts a local deployment, and prompts for any initial setup it needs. In two terminals, keep the backend and app running:

```bash
pnpm dev:backend
pnpm dev
```

The Better Auth server expects `SITE_URL=http://localhost:3000` in the Convex deployment. Set it once if Convex did not already do so:

```bash
npx convex env set SITE_URL http://localhost:3000
```

Start LM Studio's local server with `google/gemma-4-12b-qat` loaded. The defaults point to `http://127.0.0.1:1234`; no API credential is needed. Override them with `LM_STUDIO_URL` and `LM_STUDIO_MODEL` in `.env.local` if necessary. Sign up with any local email and password; accounts are stored in the local Convex deployment.

You can instead connect a ChatGPT Plus or Pro account from the **OpenAI Codex** card in the sidebar. Autodekt uses OpenAI's device-code flow, stores the per-user OAuth credential in Convex, refreshes it on the server, and sends chat requests through Codex using `gpt-5.6-sol`. Disconnecting removes the stored credential. LM Studio remains the fallback whenever Codex is not connected.

Add your Brave Search API key to `.env.local` using the exact requested variable name, then restart the app:

```dotenv
BRAVE_API_KEY=your-key-here
```

## What the MVP does

- Provides a ChatGPT-style workspace with authenticated deck-scoped conversation threads.
- Persists users, decks, threads, message history, normalized cards, and deck edit history in Convex.
- Lets the user and assistant edit the same Moxfield-inspired list with commander, main-deck, and maybeboard zones.
- Groups by custom tag, card type, color identity, mana value, or board; sorts by name, mana value, or type.
- Imports common text and Arena-style decklists through Scryfall's batched collection endpoint.
- Streams agent conversations through TanStack AI.
- Synthesizes deck-tech and strategy guidance with a local LM Studio model.
- Searches current deck-tech guides and strategy sources through Brave Search and returns source links.
- Searches current Oracle card data through Scryfall.
- Requires a current Scryfall Oracle-text lookup before the model gives feedback about a named card.
- Searches a local index of Wizards' official Comprehensive Rules by rule number, glossary term, or natural-language phrase.
- Requires a Comprehensive Rules lookup before the model answers rules and card-interaction questions.
- Estimates lands, ramp, draw, targeted interaction, wipes, protection, tutors, and average mana value.

Functional roles are deliberately overlapping and heuristic. They are evidence for the agent, not a substitute for reading cards in the context of a deck's plan.

## Local rules source

The repository includes Wizards of the Coast's English Comprehensive Rules PDF and matching TXT edition, effective June 19, 2026, under `src/data/mtg-rules/`. The PDF is the retained source document; the matching text edition powers deterministic lookup. The live source of truth remains [Wizards' rules page](https://magic.wizards.com/en/rules), which should be checked when refreshing these files.

Live guide discovery uses Brave Search, while current card text and Commander legality continue to come from Scryfall.
