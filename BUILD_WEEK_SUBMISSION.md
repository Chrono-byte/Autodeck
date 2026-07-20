# OpenAI Build Week submission kit

Submission deadline: **Tuesday, July 21, 2026 at 5:00 PM Pacific / 8:00 PM Eastern**.

Recommended track: **Apps for Your Life**.

Autodekt is primarily a consumer tool for a player's personal Commander deckbuilding workflow. Its engineering is substantial enough for Developer Tools, but its audience and demonstrated outcome fit Apps for Your Life more directly.

## Devpost copy

### Project name

Autodekt

### Tagline

An agentic Commander deckbuilding workspace where the player and GPT-5.6 research, analyze, validate, and edit a persistent deck together.

### Short description

Commander deckbuilding is an open-ended research problem, not a one-shot prompt. Autodekt gives players a persistent deck editor and a GPT-5.6 collaborator that share the same live workspace. The agent can inspect and edit the active deck, verify current Oracle text and Commander legality through Scryfall, search the official Comprehensive Rules, research current strategy with citations, analyze curve and colored sources, and export the finished list for MTGO.

The key product choice is to separate judgment from facts. GPT-5.6 decides how to help and when to use tools, while deterministic code enforces deck ownership, validates Commander constraints, parses deck queries, and persists edits. That makes the assistant useful without asking players to trust memorized card text or an opaque generated list.

Autodekt runs as an Electron desktop app, with Convex-backed decks, conversations, preferences, and edit history. Players connect their own ChatGPT account through the local Codex app-server device flow; credentials remain local and are not stored in Convex.

### How Codex was used

Codex was the primary development collaborator across the project. It helped turn product research into implementation, trace failures across streamed Codex events, TanStack AI state, React rendering, Convex persistence, and Electron IPC, and pressure-test the boundary between model judgment and deterministic safeguards. Focused Codex sessions built and verified the persistent shared workspace, grounded card and rules tools, Brave research, Commander validation and deck analysis, local Scryfall-style search, streamed chat reliability, ChatGPT device authorization, and the browser/desktop packaging split.

The repository's first commit is dated July 17, 2026 at 5:45 PM Eastern, within the submission period. The history contains roughly thirty commits through July 20 covering the core product, reliability work, tests, and desktop packaging. Preserve those dates and the primary Codex `/feedback` Session ID as evidence.

### How GPT-5.6 is used in the product

GPT-5.6 is the active reasoning layer in Autodekt, not a decorative mention. The app discovers available models through `codex app-server`, defaults to `gpt-5.6-sol`, streams model output and reasoning summaries into the deck-scoped conversation, and exposes deterministic deck, Scryfall, rules, and web-research tools to the model. In the demo, visibly select a GPT-5.6 model and show it invoking tools against the live deck before making and applying a recommendation.

### Built during the submission period

Use this wording only if it is factually accurate:

> Autodekt was created during the OpenAI Build Week submission period. The repository begins with commit `b469422` on July 17, 2026 and records the subsequent implementation through the final submission. Codex session history and dated commits document the build.

If any material version existed before July 13, replace that statement with a candid before/after disclosure. Pre-existing projects are judged only on work added during the submission period.

## Three-minute demo

Aim for **2:40 to 2:50**, leaving margin for the three-minute cutoff. Record in English, use voice narration, upload publicly to YouTube, and do not use copyrighted music.

### Shot list and narration

**0:00-0:20 — Problem and promise**

Show the full workspace with a real deck open.

> Commander deckbuilding takes hours of checking cards, rules, ratios, and current strategy. Autodekt turns that into one shared workspace where I edit the deck and GPT-5.6 works on the same live list with grounded tools.

**0:20-0:50 — Persistent product experience**

Quickly show deck import, grouped cards, commander zone, chat history, and the model picker with GPT-5.6 selected.

> The deck, conversations, preferences, and edit history persist in Convex. I can use the browser or the desktop app, and I connect my own ChatGPT account locally through Codex app-server.

**0:50-1:30 — Analyze and validate**

Use a prepared deck and submit: `Analyze my active deck. Check legality, role balance, mana curve, and colored sources.` Show the tool calls, then the useful part of the result.

> GPT-5.6 does the strategic reasoning, but it does not guess the deck state. Deterministic tools read the live list, count quantities, validate Commander rules, and calculate curve and colored-source pressure.

**1:30-2:05 — Current evidence**

Ask a focused current-strategy or rules question. Show a Scryfall or rules lookup and one cited Brave result.

> Named-card advice is grounded in current Scryfall data, rules questions retrieve the official Comprehensive Rules, and time-sensitive strategy research returns sources. This keeps changing facts out of model memory.

**2:05-2:25 — Shared editing outcome**

Ask the agent to apply one swap. Show the deck update and edit history, then copy or download the MTGO export.

> The assistant can safely apply an approved change to the same workspace. The player can inspect the edit history and export the finished deck directly for MTGO.

**2:25-2:48 — Codex build story**

Briefly show the Codex task history or a compact montage of representative sessions and dated commits.

> I built Autodekt with Codex and GPT-5.6 throughout Build Week. Codex helped design the tool boundary, implement features across TanStack AI, Convex, and Electron, diagnose streaming and cancellation races, and verify each slice with tests and real runtime checks. The result is a complete product experience, not a chat-box prototype.

**2:48-2:55 — Close**

> Autodekt lets Commander players spend less time reconciling scattered tools and more time making intentional deckbuilding decisions.

## Recording setup

- Use a complete, preloaded Commander deck whose analysis returns quickly and has one obvious, safe swap.
- Connect GPT-5.6 and warm all external caches before recording.
- Pre-run the exact analysis and research prompts once to confirm latency and output length.
- Set browser/UI zoom so the deck, tool activity, and answer remain legible at 1080p.
- Hide email addresses, device codes, tokens, local filesystem paths, and unrelated task titles.
- Record the product flow first; add narration afterward if that produces a cleaner take.
- Keep a backup take and verify the final public YouTube URL in a signed-out browser.

## Eligibility and evidence checklist

- [ ] Register and submit before July 21 at 5:00 PM Pacific / 8:00 PM Eastern.
- [ ] Choose exactly one track: Apps for Your Life.
- [ ] Use the primary Codex build task's `/feedback` Session ID.
- [ ] Verify that the selected session contains the majority of core development, not only submission prep.
- [ ] Preserve dated Git history and explain whether the project was new or meaningfully extended after July 13.
- [ ] Explicitly name both Codex and GPT-5.6 in the description, README, repository, and narrated demo.
- [ ] Show GPT-5.6 doing meaningful in-product work with tools.
- [ ] Keep the public YouTube demo under three minutes and include English audio.
- [ ] Provide a repository URL. If private, share it with `testing@devpost.com` and `build-week-event@openai.com`.
- [ ] Give judges a free working website, demo, or test build through the end of judging on August 5.
- [ ] Include setup, sample data, exact test steps, supported platforms, and a no-rebuild testing path.
- [ ] Remove secrets, local credentials, `.env.local`, `.codex-runtime`, caches, and generated release credentials from the submitted repository or build.
- [ ] Add an appropriate project license if the repository will be public.
- [ ] Add a third-party notices section covering the Magic rules document, mana symbols/assets, Scryfall data/images, and every other bundled third-party asset. Confirm the actual redistribution terms before publishing.
- [ ] Do not put copyrighted music in the video.
- [ ] Open every submitted link in a signed-out/private browser before final submission.
- [ ] Submit early enough to recover from YouTube processing, repository permissions, or Devpost form problems.

## Current repository audit

### Strong points

- The project has a coherent browser and Windows desktop experience rather than only a proof of concept.
- GPT-5.6 is wired into actual inference, streaming, reasoning, and tool execution.
- The README already includes architecture, setup, a judge flow, sample data, and the Codex development story.
- Git history starts inside the submission period and contains granular implementation evidence.
- The repo contains substantial automated coverage for the agent bridge, deck tools, persistence, and UI-supporting data paths.
- The Windows packaging path succeeds and produces `apps/desktop/release/Autodekt Setup 0.1.0.exe` (100,407,164 bytes).

### Must fix before submission

1. **Judge access:** local Convex setup plus Codex CLI plus personal ChatGPT authorization is a high-friction judge path. Provide a working hosted demo, a prepared test build, or exceptionally clear credentials/instructions that satisfy the rules' free-access requirement.
2. **Licensing:** no tracked `LICENSE`, `NOTICE`, or `COPYING` file is present. A public repository must have relevant licensing, and bundled third-party materials need an accurate disclosure and redistribution review.
3. **Hackathon evidence in README:** the current working-copy edit removes the line naming OpenAI Build Week and Apps for Your Life. Add a dedicated Build Week section containing dates, track, Codex contribution, GPT-5.6 integration, `/feedback` evidence instructions, and the new-versus-existing declaration.
4. **Runtime consistency:** the README's Codex runtime-directory description should match the final Electron implementation and packaged behavior. Verify that credentials land in a device-local user-data directory in the submitted build and never in the repository.
5. **Fresh verification:** run the complete checks and rehearse the exact judge/demo path from a clean environment before recording.
6. **Installer polish:** Electron Builder reports missing package `description` and `author` metadata and uses the default Electron icon. Set those fields and a real Autodekt icon before distributing the judge build.

## Final technical gate

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check-types
pnpm test
pnpm build
pnpm package:desktop
```

Then install or unpack the artifact on a clean Windows account, initialize the documented local backend, connect Codex, import the supplied sample deck, and perform the exact demo sequence without relying on development-only files.
