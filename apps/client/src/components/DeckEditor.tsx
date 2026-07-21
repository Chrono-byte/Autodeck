import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Circle,
  Crown,
  Diamond,
  Gem,
  LoaderCircle,
  Moon,
  Mountain,
  MoreVertical,
  Plus,
  Sparkles,
  Swords,
  UserRound,
  WandSparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "@autodekt/backend/api";
import type { Doc } from "@autodekt/backend/data-model";
import { cardImageUrl } from "../lib/card-image";
import { validateCommanderDeck } from "../lib/commander-validation";
import { isManaColor, MANA_COLORS, type ManaColor, type ScryfallCard } from "../lib/deck-analysis";
import { formatMtgoDeck, mtgoExportFilename } from "../lib/mtgo-export";
import { ManaSymbol } from "./ManaSymbol";

type GroupMode = "tag" | "type" | "color" | "mana" | "zone";
type SortMode = "name" | "mana" | "type";
type ViewMode = "stacks" | "grid" | "list";
type Zone = "commander" | "main" | "maybeboard";
type InspectorPanel = "validation" | "history" | null;
type ResolvedCard = {
  name: string;
  typeLine: string;
  oracleText?: string;
  manaValue: number;
  colorIdentity: ManaColor[];
  oracleId?: string;
  oracleTags?: string[];
  illustrationIds?: string[];
  artTags?: string[];
};

const TYPE_ORDER = [
  "Commander",
  "Creature",
  "Planeswalker",
  "Sorcery",
  "Instant",
  "Artifact",
  "Enchantment",
  "Battle",
  "Land",
  "Other",
  "Maybeboard",
];

function primaryType(typeLine: string) {
  return (
    [
      "Creature",
      "Planeswalker",
      "Artifact",
      "Enchantment",
      "Instant",
      "Sorcery",
      "Battle",
      "Land",
    ].find((type) => typeLine.includes(type)) ?? "Other"
  );
}

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase();
}

function GroupIcon({ label }: { label: string }) {
  const icons: Record<string, LucideIcon> = {
    Commander: Crown,
    Creature: UserRound,
    Planeswalker: Sparkles,
    Sorcery: Moon,
    Instant: Zap,
    Artifact: Gem,
    Enchantment: WandSparkles,
    Battle: Swords,
    Land: Mountain,
    Maybeboard: Diamond,
  };
  const Icon = icons[label] ?? Circle;
  return <Icon aria-hidden="true" />;
}

export function DeckEditor({
  deck,
  thread,
  cards,
  onClose,
  openImport,
  onImportOpened,
}: {
  deck: Doc<"decks">;
  thread: Doc<"threads">;
  cards: Doc<"deckCards">[];
  onClose: () => void;
  openImport?: boolean;
  onImportOpened?: () => void;
}) {
  const [group, setGroup] = useState<GroupMode>("type");
  const [sort, setSort] = useState<SortMode>("mana");
  const [view, setView] = useState<ViewMode>("stacks");
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState<Zone>("main");
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [compactViewport, setCompactViewport] = useState(false);
  const [inspectorPanel, setInspectorPanel] = useState<InspectorPanel>(null);
  const [currentCards, setCurrentCards] = useState<ScryfallCard[] | null>(null);
  const [validationLookupFailed, setValidationLookupFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(cards[0]?._id ?? null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importBoxRef = useRef<HTMLDivElement>(null);
  const [cardMenu, setCardMenu] = useState<{
    card: Doc<"deckCards">;
    x: number;
    y: number;
  } | null>(null);
  const upsert = useMutation(api.deckCards.upsert);
  const remove = useMutation(api.deckCards.remove);
  const updateTags = useMutation(api.deckCards.updateTags);
  const updateSearchMetadata = useMutation(api.deckCards.updateSearchMetadata);
  const syncCommanderMetadata = useMutation(api.deckCards.syncCommanderMetadata);
  const deckEvents = useQuery(api.deckEvents.list, { deckId: deck._id });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompactViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!openImport) return;
    setImporting(true);
    onImportOpened?.();
  }, [onImportOpened, openImport]);

  const validationKey = useMemo(
    () =>
      cards
        .filter((card) => card.zone !== "maybeboard")
        .map((card) => `${card.name}:${card.updatedAt}`)
        .sort()
        .join("\n"),
    [cards],
  );

  useEffect(() => {
    if (!validationKey) {
      setValidationLookupFailed(false);
      setCurrentCards([]);
      return;
    }
    const controller = new AbortController();
    setCurrentCards(null);
    setValidationLookupFailed(false);
    const timer = window.setTimeout(() => {
      void fetch("/api/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decklist: cards
            .filter((card) => card.zone !== "maybeboard")
            .map((card) => card.name)
            .join("\n"),
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Deck validation lookup failed");
          return response.json() as Promise<{
            cards: Array<{
              name: string;
              typeLine: string;
              oracleText?: string;
              manaValue: number;
              colorIdentity: string[];
              commanderLegality?: string;
            }>;
          }>;
        })
        .then((result) => {
          setCurrentCards(
            result.cards.map((card) => ({
              name: card.name,
              type_line: card.typeLine,
              oracle_text: card.oracleText,
              cmc: card.manaValue,
              color_identity: card.colorIdentity,
              legalities: card.commanderLegality
                ? { commander: card.commanderLegality }
                : undefined,
            })),
          );
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setValidationLookupFailed(true);
          setCurrentCards(
            cards.map((card) => ({
              name: card.name,
              type_line: card.typeLine,
              oracle_text: card.oracleText,
              cmc: card.manaValue,
              color_identity: card.colorIdentity,
            })),
          );
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cards, validationKey]);

  const missingSearchMetadataKey = useMemo(
    () =>
      cards
        .filter((card) => card.oracleTags === undefined || card.artTags === undefined)
        .map((card) => `${card._id}:${card.name}`)
        .sort()
        .join("\n"),
    [cards],
  );

  const commanderMetadata = useMemo(() => {
    const commanders = cards
      .filter((card) => card.zone === "commander")
      .sort((left, right) => left.createdAt - right.createdAt);
    const colors = new Set(commanders.flatMap((commander) => commander.colorIdentity));
    return {
      name: commanders.length
        ? commanders.map((commander) => commander.name).join(" & ")
        : undefined,
      colors: MANA_COLORS.filter((color) => colors.has(color)),
    };
  }, [cards]);

  useEffect(() => {
    if (
      deck.commanderName === commanderMetadata.name &&
      deck.colorIdentity.join("") === commanderMetadata.colors.join("")
    ) {
      return;
    }
    void syncCommanderMetadata({ deckId: deck._id });
  }, [commanderMetadata, deck._id, deck.commanderName, deck.colorIdentity, syncCommanderMetadata]);

  useEffect(() => {
    if (!missingSearchMetadataKey) return;
    const missingCards = cards.filter(
      (card) => card.oracleTags === undefined || card.artTags === undefined,
    );
    const controller = new AbortController();
    void fetch("/api/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decklist: missingCards.map((card) => card.name).join("\n") }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Card search metadata lookup failed");
        return response.json() as Promise<{
          cards: Array<{
            name: string;
            oracleId?: string;
            oracleTags?: string[];
            illustrationIds?: string[];
            artTags?: string[];
          }>;
        }>;
      })
      .then(async (result) => {
        const metadataByName = new Map(
          result.cards.map((card) => [normalizeName(card.name), card] as const),
        );
        await Promise.all(
          missingCards.map(async (card) => {
            const metadata = metadataByName.get(normalizeName(card.name));
            if (!metadata?.oracleId) return;
            await updateSearchMetadata({
              cardId: card._id,
              oracleId: metadata.oracleId,
              oracleTags: metadata.oracleTags ?? [],
              illustrationIds: metadata.illustrationIds ?? [],
              artTags: metadata.artTags ?? [],
            });
          }),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [cards, missingSearchMetadataKey, updateSearchMetadata]);

  useEffect(() => {
    if (selectedId && cards.some((card) => card._id === selectedId)) return;
    setSelectedId(cards[0]?._id ?? null);
  }, [cards, selectedId]);

  useEffect(() => {
    if (!importing) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (importButtonRef.current?.contains(target) || importBoxRef.current?.contains(target))
        return;
      setImporting(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImporting(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [importing]);

  useEffect(() => {
    if (!cardMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".card-context-menu")) return;
      setCardMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCardMenu(null);
    };
    const closeOnViewportChange = () => setCardMenu(null);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [cardMenu]);

  const grouped = useMemo(() => {
    const keyFor = (card: Doc<"deckCards">) => {
      if (card.zone === "commander") return "Commander";
      if (card.zone === "maybeboard") return "Maybeboard";
      if (group === "tag") return card.tags[0] ?? "Untagged";
      if (group === "type") return primaryType(card.typeLine);
      if (group === "color")
        return card.colorIdentity.length ? card.colorIdentity.join("") : "Colorless";
      if (group === "mana")
        return card.typeLine.includes("Land") ? "Land" : `${card.manaValue} mana`;
      return "Main deck";
    };
    const compare = (a: Doc<"deckCards">, b: Doc<"deckCards">) => {
      if (sort === "mana") return a.manaValue - b.manaValue || a.name.localeCompare(b.name);
      if (sort === "type")
        return a.typeLine.localeCompare(b.typeLine) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    };
    const result = new Map<string, Doc<"deckCards">[]>();
    for (const card of [...cards].sort(compare)) {
      const key = keyFor(card);
      result.set(key, [...(result.get(key) ?? []), card]);
    }
    return [...result.entries()].sort(([a], [b]) => {
      const aIndex = TYPE_ORDER.indexOf(a);
      const bIndex = TYPE_ORDER.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) {
        return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
      }
      return a.localeCompare(b);
    });
  }, [cards, group, sort]);

  const selectedCard = cards.find((card) => card._id === selectedId) ?? cards[0];
  const saveResolved = async (
    card: ResolvedCard,
    quantity: number,
    targetZone: Zone,
    tags: string[] = [],
  ) => {
    await upsert({
      deckId: deck._id,
      threadId: thread._id,
      actor: "user",
      name: card.name,
      quantity,
      zone: targetZone,
      typeLine: card.typeLine,
      oracleText: card.oracleText,
      manaValue: card.manaValue,
      colorIdentity: card.colorIdentity,
      oracleId: card.oracleId,
      oracleTags: card.oracleTags,
      illustrationIds: card.illustrationIds,
      artTags: card.artTags,
      tags,
    });
  };

  const updateCard = async (
    card: Doc<"deckCards">,
    changes: Partial<{ quantity: number; zone: Zone }>,
  ) => {
    const targetZone = changes.zone ?? card.zone;
    if (targetZone !== card.zone) {
      await remove({ cardId: card._id, threadId: thread._id, actor: "user" });
    }
    await upsert({
      deckId: deck._id,
      threadId: thread._id,
      actor: "user",
      name: card.name,
      quantity: changes.quantity ?? card.quantity,
      zone: targetZone,
      typeLine: card.typeLine,
      oracleText: card.oracleText,
      manaValue: card.manaValue,
      colorIdentity: card.colorIdentity,
      oracleId: card.oracleId,
      oracleTags: card.oracleTags,
      illustrationIds: card.illustrationIds,
      artTags: card.artTags,
      tags: card.tags,
    });
  };

  const addCard = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/cards/resolve?name=${encodeURIComponent(query)}`);
      const card = (await response.json()) as ResolvedCard & { error?: string };
      card.colorIdentity = card.colorIdentity.filter(isManaColor);
      if (response.ok) {
        await saveResolved(card, 1, zone);
        setQuery("");
      } else setNotice(card.error ?? "Card not found.");
    } finally {
      setBusy(false);
    }
  };

  const importList = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decklist: importText }),
      });
      const result = (await response.json()) as {
        cards?: Array<ResolvedCard & { quantity: number }>;
        unresolved?: string[];
        error?: string;
      };
      if (!response.ok || !result.cards) setNotice(result.error ?? "Import failed.");
      else {
        for (const card of result.cards) await saveResolved(card, card.quantity, "main");
        setNotice(
          `Imported ${result.cards.length} cards${result.unresolved?.length ? `; unresolved: ${result.unresolved.join(", ")}` : "."}`,
        );
        setImportText("");
        setImporting(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const exportMtgo = () => {
    const exportedCards = cards.filter((card) => card.zone !== "maybeboard");
    if (!exportedCards.length) return;

    const filename = mtgoExportFilename(deck.name);
    const blob = new Blob([formatMtgoDeck(exportedCards)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    const omitted = cards.filter((card) => card.zone === "maybeboard").length;
    setNotice(
      omitted
        ? `Exported ${filename}. Maybeboard cards were omitted because MTGO does not support that zone.`
        : `Exported ${filename}.`,
    );
  };

  const copyMtgo = async () => {
    const exportedCards = cards.filter((card) => card.zone !== "maybeboard");
    if (!exportedCards.length) return;

    try {
      await navigator.clipboard.writeText(formatMtgoDeck(exportedCards));
      const omitted = cards.filter((card) => card.zone === "maybeboard").length;
      setNotice(
        omitted
          ? "Copied MTGO decklist. Maybeboard cards were omitted because MTGO does not support that zone."
          : "Copied MTGO decklist to clipboard.",
      );
    } catch {
      setNotice("Could not copy the MTGO decklist. Check this site's clipboard permission.");
    }
  };

  const deckTotal = cards
    .filter((card) => card.zone !== "maybeboard")
    .reduce((sum, card) => sum + card.quantity, 0);
  const maybeboard = cards
    .filter((card) => card.zone === "maybeboard")
    .reduce((sum, card) => sum + card.quantity, 0);
  const counts = Object.fromEntries(
    ["Creature", "Sorcery", "Instant", "Artifact", "Enchantment", "Land"].map((type) => [
      type,
      cards
        .filter((card) => card.zone !== "maybeboard" && primaryType(card.typeLine) === type)
        .reduce((sum, card) => sum + card.quantity, 0),
    ]),
  ) as Record<string, number>;
  const validation = validateCommanderDeck(cards, currentCards ?? []);
  const validationWarnings = validationLookupFailed
    ? ["Current Scryfall legality could not be refreshed; stored card rules were checked instead."]
    : validation.warnings;
  const validationLoading = currentCards === null;
  const deckStatus = validationLoading
    ? "Checking…"
    : validation.errors.length
      ? `${validation.errors.length} ${validation.errors.length === 1 ? "issue" : "issues"}`
      : validationWarnings.length
        ? "Needs review"
        : "Legal";
  const renderedView: ViewMode = compactViewport ? "list" : view;
  const zoneLabel =
    zone === "main" ? "main deck" : zone === "commander" ? "command zone" : "maybeboard";

  return (
    <aside className="deck-pane">
      <header className="pane-header deck-titlebar">
        <div>
          <p className="eyebrow">Commander · Deck editor</p>
          <h2>{deck.name}</h2>
          <div className="deck-identity" aria-label="Deck identity">
            {deck.colorIdentity.length ? (
              deck.colorIdentity.map((color) => (
                <ManaSymbol key={color} symbol={color} className="deck-color-symbol" />
              ))
            ) : (
              <ManaSymbol symbol="C" className="deck-color-symbol" />
            )}
            <span>{deck.commanderName ?? "Commander not set"}</span>
          </div>
        </div>
        <div className="deck-title-actions">
          <button
            type="button"
            className={`deck-count ${!validationLoading && validation.valid && !validationWarnings.length ? "complete" : ""}`}
            aria-expanded={inspectorPanel === "validation"}
            onClick={() =>
              setInspectorPanel((current) => (current === "validation" ? null : "validation"))
            }
          >
            {deckTotal} / 100 · {deckStatus}
          </button>
          <button
            type="button"
            className="deck-history-button"
            aria-expanded={inspectorPanel === "history"}
            onClick={() =>
              setInspectorPanel((current) => (current === "history" ? null : "history"))
            }
          >
            History
          </button>
          <button
            type="button"
            className="deck-pane-close"
            onClick={onClose}
            aria-label="Hide deck"
          >
            Hide deck
          </button>
        </div>
      </header>

      {inspectorPanel === "validation" && (
        <section className="deck-inspector" aria-label="Deck validation">
          <header>
            <div>
              <strong>Commander validation</strong>
              <span>Count, commander pairing, singleton, color identity, and format legality</span>
            </div>
            <button
              type="button"
              onClick={() => setInspectorPanel(null)}
              aria-label="Close validation"
            >
              Close
            </button>
          </header>
          {validationLoading ? (
            <p>Checking the current card data…</p>
          ) : validation.errors.length || validationWarnings.length ? (
            <ul>
              {validation.errors.map((error) => (
                <li className="validation-error" key={error}>
                  {error}
                </li>
              ))}
              {validationWarnings.map((warning) => (
                <li className="validation-warning" key={warning}>
                  {warning}
                </li>
              ))}
            </ul>
          ) : (
            <p className="validation-success">No Commander legality issues found.</p>
          )}
        </section>
      )}

      {inspectorPanel === "history" && (
        <section className="deck-inspector deck-history" aria-label="Deck edit history">
          <header>
            <div>
              <strong>Edit history</strong>
              <span>User and assistant changes to this deck</span>
            </div>
            <button
              type="button"
              onClick={() => setInspectorPanel(null)}
              aria-label="Close history"
            >
              Close
            </button>
          </header>
          {deckEvents === undefined ? (
            <p>Loading changes…</p>
          ) : deckEvents.length ? (
            <ol>
              {deckEvents.map((event) => (
                <li key={event._id}>
                  <span className={`history-actor ${event.actor}`}>{event.actor}</span>
                  <div>
                    <strong>
                      {event.action}
                      {event.cardName ? ` · ${event.cardName}` : ""}
                    </strong>
                    <span>
                      {event.detail ? `${event.detail} · ` : ""}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(event.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>No deck changes have been recorded yet.</p>
          )}
        </section>
      )}

      <div className="deck-commandbar">
        <div className="card-add-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addCard();
            }}
            placeholder={`Find and add cards to ${zoneLabel}…`}
            aria-label={`Find a card to add to ${zoneLabel}`}
          />
          <select
            value={zone}
            onChange={(event) => setZone(event.target.value as Zone)}
            aria-label="Add card to"
          >
            <option value="main">Main</option>
            <option value="commander">Commander</option>
            <option value="maybeboard">Maybe</option>
          </select>
          <button
            onClick={() => void addCard()}
            disabled={busy}
            aria-label={`Add card to ${zoneLabel}`}
          >
            {busy ? (
              <LoaderCircle className="spinning" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="deck-toolbar">
          <label>
            View
            <select
              value={renderedView}
              onChange={(event) => setView(event.target.value as ViewMode)}
              aria-label="View"
              disabled={compactViewport}
              title={
                compactViewport
                  ? "Compact list is used on small screens for performance"
                  : undefined
              }
            >
              <option value="stacks">Visual stacks</option>
              <option value="grid">Visual grid</option>
              <option value="list">Compact list</option>
            </select>
          </label>
          <label>
            Group
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value as GroupMode)}
              aria-label="Group"
            >
              <option value="type">Type</option>
              <option value="tag">Tag</option>
              <option value="color">Color</option>
              <option value="mana">Mana value</option>
              <option value="zone">Board</option>
            </select>
          </label>
          <label>
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              aria-label="Sort"
            >
              <option value="mana">Mana value</option>
              <option value="name">Name</option>
              <option value="type">Type</option>
            </select>
          </label>
          <button
            ref={importButtonRef}
            className="text-button"
            onClick={() => setImporting(!importing)}
            aria-expanded={importing}
          >
            {importing ? "Close import" : "Import"}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={exportMtgo}
            disabled={!cards.some((card) => card.zone !== "maybeboard")}
            title="Download a Magic Online-compatible text decklist"
          >
            Export MTGO
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => void copyMtgo()}
            disabled={!cards.some((card) => card.zone !== "maybeboard")}
            title="Copy a Magic Online-compatible text decklist"
          >
            Copy MTGO
          </button>
        </div>
      </div>

      {importing && (
        <div className="import-box" ref={importBoxRef}>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={"1 Sol Ring\n1 Arcane Signet\n36 Island"}
            rows={7}
          />
          <button className="primary-button" onClick={() => void importList()} disabled={busy}>
            Import list
          </button>
        </div>
      )}
      {notice && <div className="notice-banner">{notice}</div>}

      <div
        className={`deck-browser ${renderedView === "stacks" ? "stacks-view" : ""} ${renderedView === "list" ? "list-view" : ""} ${renderedView === "grid" ? "grid-view" : ""}`}
      >
        {selectedCard && (
          <aside className="card-preview" aria-label="Selected card preview">
            <div className="preview-image-shell">
              <img src={cardImageUrl(selectedCard.name, "normal")} alt={selectedCard.name} />
              {selectedCard.quantity > 1 && (
                <span className="preview-quantity">×{selectedCard.quantity}</span>
              )}
            </div>
            <div className="preview-copy">
              <strong>{selectedCard.name}</strong>
              <span>{selectedCard.typeLine}</span>
              {selectedCard.oracleText && <p>{selectedCard.oracleText}</p>}
            </div>
            <div className="preview-editor">
              <label>
                Qty
                <input
                  type="number"
                  min="1"
                  value={selectedCard.quantity}
                  onChange={(event) =>
                    void updateCard(selectedCard, { quantity: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Board
                <select
                  value={selectedCard.zone}
                  onChange={(event) =>
                    void updateCard(selectedCard, { zone: event.target.value as Zone })
                  }
                >
                  <option value="main">Main</option>
                  <option value="commander">Commander</option>
                  <option value="maybeboard">Maybeboard</option>
                </select>
              </label>
              <label className="preview-tags">
                Tags
                <input
                  defaultValue={selectedCard.tags.join(", ")}
                  placeholder="Ramp, Draw…"
                  onBlur={(event) =>
                    void updateTags({
                      cardId: selectedCard._id,
                      tags: event.target.value.split(","),
                    })
                  }
                />
              </label>
              <button
                className="preview-remove"
                onClick={() =>
                  void remove({ cardId: selectedCard._id, threadId: thread._id, actor: "user" })
                }
              >
                Remove card
              </button>
            </div>
          </aside>
        )}

        <div className="deck-groups">
          {grouped.map(([label, groupCards]) => (
            <section className="card-group" key={label}>
              <header>
                <h3>
                  <GroupIcon label={label} /> {label}
                  <b>({groupCards.reduce((sum, card) => sum + card.quantity, 0)})</b>
                </h3>
                <span>{groupCards.length} unique</span>
              </header>
              <div className={`visual-stack ${renderedView === "grid" ? "card-grid" : ""}`}>
                {groupCards.map((card) => {
                  const isSelected = card._id === selectedCard?._id;
                  return (
                    <div
                      className={`stack-card ${renderedView === "grid" ? "grid-card" : ""} ${isSelected ? "selected" : ""}`}
                      key={card._id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(card._id)}
                      onFocus={() => setSelectedId(card._id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSelectedId(card._id);
                        setCardMenu({
                          card,
                          x: Math.max(8, Math.min(event.clientX, window.innerWidth - 224)),
                          y: Math.max(8, Math.min(event.clientY, window.innerHeight - 292)),
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(card._id);
                          return;
                        }
                        if (event.shiftKey && event.key === "F10") {
                          event.preventDefault();
                          const bounds = event.currentTarget.getBoundingClientRect();
                          setCardMenu({
                            card,
                            x: Math.max(8, Math.min(bounds.left + 24, window.innerWidth - 224)),
                            y: Math.max(8, Math.min(bounds.top + 30, window.innerHeight - 292)),
                          });
                        }
                      }}
                      aria-haspopup="menu"
                      aria-label={`${card.name}, mana value ${card.manaValue}`}
                      title={card.oracleText}
                    >
                      {renderedView !== "list" && (
                        <img loading="lazy" src={cardImageUrl(card.name, "normal")} alt="" />
                      )}
                      <span className="stack-card-shade" />
                      {card.quantity > 1 && <b className="stack-quantity">{card.quantity}</b>}
                      <strong>{card.name}</strong>
                      <small>{card.manaValue === 0 ? "—" : card.manaValue}</small>
                      <button
                        type="button"
                        className="stack-menu-button"
                        aria-label={`Open menu for ${card.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(card._id);
                          const bounds = event.currentTarget.getBoundingClientRect();
                          setCardMenu({
                            card,
                            x: Math.max(8, Math.min(bounds.right + 4, window.innerWidth - 224)),
                            y: Math.max(8, Math.min(bounds.top, window.innerHeight - 292)),
                          });
                        }}
                      >
                        <MoreVertical aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {!cards.length && (
            <div className="deck-empty">
              Add cards individually or import a text list. The assistant can edit this list too.
            </div>
          )}
        </div>
      </div>

      {cardMenu && (
        <div
          className="card-context-menu"
          role="menu"
          aria-label={`Actions for ${cardMenu.card.name}`}
          style={{ left: cardMenu.x, top: cardMenu.y }}
        >
          <p>{cardMenu.card.name}</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCardMenu(null);
              void updateCard(cardMenu.card, { quantity: cardMenu.card.quantity + 1 });
            }}
          >
            Add another copy
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={cardMenu.card.quantity <= 1}
            onClick={() => {
              setCardMenu(null);
              void updateCard(cardMenu.card, { quantity: cardMenu.card.quantity - 1 });
            }}
          >
            Remove one copy
          </button>
          <div className="card-context-divider" />
          {cardMenu.card.zone !== "commander" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCardMenu(null);
                void updateCard(cardMenu.card, { zone: "commander" });
              }}
            >
              Move to commander
            </button>
          )}
          {cardMenu.card.zone !== "main" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCardMenu(null);
                void updateCard(cardMenu.card, { zone: "main" });
              }}
            >
              Move to main deck
            </button>
          )}
          {cardMenu.card.zone !== "maybeboard" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCardMenu(null);
                void updateCard(cardMenu.card, { zone: "maybeboard" });
              }}
            >
              Move to maybeboard
            </button>
          )}
          <div className="card-context-divider" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setCardMenu(null);
              void remove({
                cardId: cardMenu.card._id,
                threadId: thread._id,
                actor: "user",
              });
            }}
          >
            Remove from deck
          </button>
        </div>
      )}

      <footer className="deck-summary-bar">
        <span>
          <b>{deckTotal}</b> main deck
        </span>
        <span>
          <b>{maybeboard}</b> maybeboard
        </span>
        <div className="summary-types">
          {Object.entries(counts).map(([type, count]) => (
            <span key={type} title={type}>
              <GroupIcon label={type} /> <b>{count}</b>
            </span>
          ))}
        </div>
      </footer>
    </aside>
  );
}
