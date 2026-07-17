# Autodekt

An agentic Magic: The Gathering Commander deck research and tuning workspace built with TanStack Start and TanStack AI.

## First run

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Start LM Studio's local server with `google/gemma-4-12b-qat` loaded. The defaults point to `http://127.0.0.1:1234`; no API credential is needed. Override them with `LM_STUDIO_URL` and `LM_STUDIO_MODEL` if necessary.

## What the MVP does

- Streams an agent conversation through TanStack AI.
- Synthesizes deck-tech and strategy guidance with a local LM Studio model.
- Searches current Oracle card data through Scryfall.
- Requires a current Scryfall Oracle-text lookup before the model gives feedback about a named card.
- Searches a local index of Wizards' official Comprehensive Rules by rule number, glossary term, or natural-language phrase.
- Requires a Comprehensive Rules lookup before the model answers rules and card-interaction questions.
- Parses common text and Arena-style decklists.
- Batches deck lookups through Scryfall's collection endpoint.
- Estimates lands, ramp, draw, targeted interaction, wipes, protection, tutors, and average mana value.

Functional roles are deliberately overlapping and heuristic. They are evidence for the agent, not a substitute for reading cards in the context of a deck's plan.

## Local rules source

The repository includes Wizards of the Coast's English Comprehensive Rules PDF and matching TXT edition, effective June 19, 2026, under `src/data/mtg-rules/`. The PDF is the retained source document; the matching text edition powers deterministic lookup. The live source of truth remains [Wizards' rules page](https://magic.wizards.com/en/rules), which should be checked when refreshing these files.

The local model has no native live-web search. Current card data still comes from Scryfall; reviewing current deck-tech articles requires adding a separate search/fetch provider or supplying source URLs.
