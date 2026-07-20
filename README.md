# Autodekt

Autodekt is an agentic Magic: The Gathering Commander deckbuilding workspace. It combines a persistent, Moxfield-inspired deck editor with an AI collaborator that can research strategy, inspect the live deck, verify card text and rules, analyze deck structure, and edit alongside the player.

## Why Autodekt

Commander deckbuilding is an open-ended research problem. A useful assistant needs more than a chat box: it must understand the player's list, distinguish current card data from model knowledge, check official rules, find recent community strategy, and preserve decisions across a long tuning session.

Autodekt turns those requirements into one shared workspace. The player and agent work on the same persistent deck, while deterministic tools and current sources keep the model grounded.

## What it does

- Provides a ChatGPT-style, deck-scoped conversation with Markdown, reasoning summaries, live tool-call UI, queued steering, and model-aware retries.
- Persists users, decks, conversations, messages, normalized card metadata, preferences, and deck edit history in Convex.
- Lets the player and agent edit the same deck across commander, main-deck, and maybeboard zones.
- Imports common text and Arena-style decklists, then groups and sorts cards by board, custom tag, type, color identity, mana value, or name.
- Reads, searches, analyzes, validates, and edits the active deck without requiring the list to be pasted back into chat.
- Checks card count, command zone, singleton rules, color identity, and current Commander legality.
- Estimates lands, ramp, draw, interaction, wipes, protection, tutors, mana curve, and colored-pip demand versus reusable mana sources.
- Uses Scryfall for current Oracle text, legality, card discovery, art tags, and community-curated Oracle Tagger concepts.
- Searches Wizards' Comprehensive Rules by rule number, glossary term, or natural-language question.
- Uses Brave Search for time-sensitive deck tech, strategy, metagame, budget, and pricing research with source links.
- Exports MTGO-compatible deck text to a file or the clipboard.
- Runs in the browser or in a native Electron desktop shell with long-lived local card-image caching.

Role and mana-base analysis is intentionally heuristic. It gives the agent structured evidence to reason from; it does not replace reading each card in the context of the deck's plan.

## Quick start

### Prerequisites

- Node.js with Corepack and pnpm 11.5.3
- A local Convex deployment, created by the setup command below
- One inference option:
  - a ChatGPT Plus or Pro account connected from Autodekt for GPT-5.6/Codex models, with the Codex CLI installed and available as `codex`, or
  - [LM Studio](https://lmstudio.ai/) for the local fallback
- Optional: a Brave Search API key for live web research

Install dependencies and initialize the local backend:

```bash
pnpm install
pnpm --filter @autodekt/backend dev:once
```

The Convex command creates `packages/backend/.env.local`, starts a local deployment, and prompts for any initial setup it needs. The client automatically maps the generated Convex URLs into its Vite environment.

If Convex did not set the Better Auth origin, set it once:

```bash
pnpm --dir packages/backend exec convex env set SITE_URL http://localhost:3000
```

Start the backend and browser client in separate terminals:

```bash
pnpm dev:backend
pnpm dev:client
```

Open [http://localhost:3000](http://localhost:3000), create a local account with any email and password, and create a deck. Accounts and workspace data stay in the local Convex deployment.

You can also start both tasks through Turborepo:

```bash
pnpm dev
```

## Connect GPT-5.6 through Codex

In Autodekt, open **Settings → OpenAI Codex → Connect** and complete the device-code flow with a ChatGPT Plus or Pro account. Then choose a GPT-5.6 model under **Settings → Generation** or from the composer model picker.

Autodekt starts `codex app-server` and communicates with it over its JSON-RPC stdio protocol for device authorization, model discovery, token refresh, inference, streamed reasoning, and deck-tool calls. Install the Codex CLI and ensure `codex` is on the app process's `PATH`; alternatively, set `CODEX_EXECUTABLE` to its absolute path.

Subscription login and inference are accepted only from a loopback app origin (`localhost` or `127.x.x.x`). Each Autodekt account gets an isolated Codex home in the gitignored `.codex-runtime/app-server` directory; credentials are never stored in Convex. Disconnecting signs that isolated Codex session out.

If a Codex model is selected without an active connection, the request fails clearly rather than silently switching providers.

## Optional services

Copy `.env.example` to `.env.local` and configure the services you want:

```dotenv
LM_STUDIO_URL=http://127.0.0.1:1234
LM_STUDIO_MODEL=google/gemma-4-12b-qat
BRAVE_API_KEY=your-key-here
LOG_LEVEL=info
CODEX_EXECUTABLE=codex
```

For local inference, start LM Studio's server with the configured model loaded. No local API credential is required. `LM_STUDIO_TEXT_MODEL` can override the model used for automatic thread titles. Local Gemma remains available in the model picker without an OpenAI connection.

`BRAVE_API_KEY` is optional, but live deck-tech and metagame research is unavailable without it. The key is read-only by server code.

## Judge/demo flow

No seed data or test account is required. After signing up locally:

1. Create a deck and import a Commander list in common text or Arena format.
2. Connect OpenAI Codex and select a GPT-5.6 model.
3. Ask: `Analyze my active deck. Check its legality, role balance, mana curve, and colored sources.`
4. Ask: `Research current upgrade guides for this commander, cite your sources, and suggest three swaps within the deck's plan.`
5. Ask a card interaction question to see Autodekt retrieve current Oracle text and the relevant Comprehensive Rules before answering.
6. Ask the agent to make one of its proposed swaps, then inspect the shared deck and edit history.
7. Export the result as MTGO text or copy it to the clipboard.

For a fast partial-list smoke test, import:

```text
Commander
1 Muldrotha, the Gravetide

Deck
1 Sol Ring
1 Command Tower
1 Sakura-Tribe Elder
1 Eternal Witness
1 Beast Within
```

The validator will correctly report that this is not yet a complete Commander deck, while the search, analysis, card-data, rules, and editing flows remain testable.

## Desktop app

Keep the backend running and launch the Electron shell:

```bash
pnpm dev:backend
pnpm dev:desktop
```

In development, Electron reuses a client already running at `http://localhost:3000`; otherwise it starts and owns the client process. Set `AUTODEKT_CLIENT_URL` to wrap another local development origin.

The production desktop path serves the compiled TanStack application from an embedded loopback HTTP server and does not run Vite:

```bash
pnpm start:desktop
```

Create the Windows installer with:

```bash
pnpm package:desktop
```

## Architecture

```text
apps/
  client/      TanStack Start UI, TanStack AI agent, and HTTP routes
  desktop/     Electron main process, preload bridges, and native shell
packages/
  backend/     Convex schema, functions, generated bindings, and local state
  config/      Shared TypeScript configuration
```

The root package is orchestration-only. The client imports generated Convex bindings via `@autodekt/backend`; package code does not span workspace folders.

The main agent boundary is deliberate:

```text
Player + persistent deck
          ↓
  TanStack AI agent
          ↓
  ┌───────────────┬─────────────────┬──────────────────┐
  │ deterministic │ current factual │ current research │
  │ deck tools    │ sources         │ sources          │
  │ analyze/edit  │ Scryfall/rules  │ Brave Search     │
  └───────────────┴─────────────────┴──────────────────┘
```

Game invariants—ownership, deck zones, Commander legality, query validation, and persisted edits—live in code. The model decides when to use tools and how to synthesize their evidence, but it cannot bypass those constraints. Named-card advice requires a current Scryfall lookup, and rules questions require a Comprehensive Rules lookup.

Large streamed conversations are stored incrementally in paginated message records, with oversized tool and reasoning payloads split into chunks. Codex app-server notifications and dynamic-tool requests are normalized at one bridge boundary so the rest of the chat UI consumes the same stable event contract as local inference.

## How Codex and GPT-5.6 shaped the project

Autodekt was developed as a sequence of real Codex sessions, beginning with the persistent Commander workspace and continuing through focused feature, reliability, and product-polish passes. Codex accelerated the work in four ways:

- **Research to implementation:** Codex checked live Brave, Scryfall, Electron, Convex, and OpenAI/Codex contracts, then implemented the integrations and regression tests in the same session.
- **Cross-boundary reasoning:** GPT-5.6 traced failures across streamed provider events, TanStack AI state, React rendering, Convex persistence, and Electron preload IPC instead of treating symptoms in isolation.
- **Decision pressure-testing:** Codex helped separate model judgment from deterministic safeguards—for example, keeping mechanics in tools, validation in code, and source requirements in the system prompt.
- **Continuous verification:** Each focused change was validated through the relevant TypeScript, test, lint, build, Convex code-generation, API smoke-test, or Electron runtime path before the next feature was layered on.

Representative Codex-built slices include the shared deck/thread data model, grounded Scryfall and rules tools, Brave research with citations, quantity-aware deck analysis, Oracle Tagger discovery, local Scryfall-style deck search, MTGO export, resilient card-image caching, rich streamed chat UI, queued steering, Codex app-server authentication and inference, and the browser/desktop monorepo split.

Key product decisions made during those sessions:

- Build a durable shared workspace, not a stateless decklist prompt.
- Prefer live or bundled authoritative data over memorized card text and rules.
- Keep browsing and model inference optional so the core workspace can run locally.
- Keep OAuth credentials on the local machine and out of application data.
- Treat community Oracle tags and deck-role counts as discovery heuristics, not rules truth.
- Normalize unreliable provider details once at the adapter boundary.

## Verification

Run the repository checks from the workspace root:

```bash
pnpm check
pnpm check-types
pnpm test
pnpm build
```

The test suite covers the Codex app-server bridge and tool schemas, Commander validation, quantity-aware analysis, local Scryfall query parsing, Oracle and art tag caches, Brave responses, rules lookup, MTGO export, image caching, authentication boundaries, message chunking, and thread behavior.

## Data and observability

The repository includes Wizards of the Coast's English Comprehensive Rules PDF and matching text edition, effective June 19, 2026, under `apps/client/src/data/mtg-rules/`. The PDF is the retained source document; the text edition powers deterministic lookup. The live source of truth remains [Wizards' rules page](https://magic.wizards.com/en/rules).

Chat and OAuth lifecycle events are emitted as structured JSON with request IDs. Prompts, authorization headers, device codes, and OAuth tokens are not intentionally logged, and known credential fields are redacted as a final safeguard. Set `LOG_LEVEL` to `debug`, `info`, `warn`, or `error`; the default is `info`. To change Convex-side OAuth logging too, run:

```bash
pnpm --dir packages/backend exec convex env set LOG_LEVEL debug
```
