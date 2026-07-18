import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

type GroupMode = "tag" | "type" | "color" | "mana" | "zone";
type SortMode = "name" | "mana" | "type";
type ViewMode = "stacks" | "grid" | "list";
type Zone = "commander" | "main" | "maybeboard";
type ResolvedCard = {
  name: string;
  typeLine: string;
  oracleText?: string;
  manaValue: number;
  colorIdentity: string[];
};
type CardImage = { imageUrl?: string; artCropUrl?: string };

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

function fallbackImage(name: string, version: "normal" | "art_crop") {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${version}`;
}

function groupIcon(label: string) {
  const icons: Record<string, string> = {
    Commander: "✦",
    Creature: "♞",
    Planeswalker: "◈",
    Sorcery: "◒",
    Instant: "ϟ",
    Artifact: "◆",
    Enchantment: "✳",
    Battle: "⚔",
    Land: "▲",
    Maybeboard: "◇",
  };
  return icons[label] ?? "•";
}

export function DeckEditor({
  deck,
  thread,
  cards,
  onClose,
}: {
  deck: Doc<"decks">;
  thread: Doc<"threads">;
  cards: Doc<"deckCards">[];
  onClose: () => void;
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
  const [selectedId, setSelectedId] = useState<string | null>(cards[0]?._id ?? null);
  const [images, setImages] = useState<Record<string, CardImage>>({});
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
  const syncCommanderMetadata = useMutation(api.deckCards.syncCommanderMetadata);

  const cardNamesKey = useMemo(
    () =>
      cards
        .map((card) => card.name)
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
      colors: ["W", "U", "B", "R", "G"].filter((color) => colors.has(color)),
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
    if (!cards.length) {
      setImages({});
      return;
    }
    const controller = new AbortController();
    void fetch("/api/cards/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: cards.map((card) => card.name) }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Image lookup failed");
        return response.json() as Promise<{
          cards: Array<{
            name: string;
            aliases: string[];
            imageUrl?: string;
            artCropUrl?: string;
          }>;
        }>;
      })
      .then((result) => {
        setImages(
          Object.fromEntries(
            result.cards.flatMap((card) =>
              [card.name, ...card.aliases].map((name) => [normalizeName(name), card] as const),
            ),
          ),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setImages({});
      });
    return () => controller.abort();
  }, [cardNamesKey]);

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
  const selectedImage = selectedCard ? images[normalizeName(selectedCard.name)] : undefined;

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
  const commanderCount = cards
    .filter((card) => card.zone === "commander")
    .reduce((sum, card) => sum + card.quantity, 0);
  const deckStatus =
    deckTotal === 100 && commanderCount > 0
      ? "Ready"
      : deckTotal > 100
        ? `${deckTotal - 100} over`
        : `${100 - deckTotal} to go`;
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
                <span key={color} className={`color-pip color-${color.toLowerCase()}`}>
                  {color}
                </span>
              ))
            ) : (
              <span className="color-pip color-c">C</span>
            )}
            <span>{deck.commanderName ?? "Commander not set"}</span>
          </div>
        </div>
        <div className="deck-title-actions">
          <span
            className={`deck-count ${deckTotal === 100 && commanderCount > 0 ? "complete" : ""}`}
          >
            {deckTotal} / 100 · {deckStatus}
          </span>
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
            {busy ? "…" : "+"}
          </button>
        </div>
        <div className="deck-toolbar">
          <label>
            View
            <select
              value={view}
              onChange={(event) => setView(event.target.value as ViewMode)}
              aria-label="View"
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
        className={`deck-browser ${view === "stacks" ? "stacks-view" : ""} ${view === "list" ? "list-view" : ""} ${view === "grid" ? "grid-view" : ""}`}
      >
        {selectedCard && (
          <aside className="card-preview" aria-label="Selected card preview">
            <div className="preview-image-shell">
              <img
                src={selectedImage?.imageUrl ?? fallbackImage(selectedCard.name, "normal")}
                alt={selectedCard.name}
              />
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
                  <span aria-hidden="true">{groupIcon(label)}</span> {label}
                  <b>({groupCards.reduce((sum, card) => sum + card.quantity, 0)})</b>
                </h3>
                <span>{groupCards.length} unique</span>
              </header>
              <div className={`visual-stack ${view === "grid" ? "card-grid" : ""}`}>
                {groupCards.map((card) => {
                  const image = images[normalizeName(card.name)];
                  const isSelected = card._id === selectedCard?._id;
                  return (
                    <div
                      className={`stack-card ${view === "grid" ? "grid-card" : ""} ${isSelected ? "selected" : ""}`}
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
                      <img
                        loading="lazy"
                        src={
                          view !== "list" || isSelected
                            ? (image?.imageUrl ?? fallbackImage(card.name, "normal"))
                            : (image?.artCropUrl ?? fallbackImage(card.name, "art_crop"))
                        }
                        alt=""
                      />
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
                        ⋮
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
              {groupIcon(type)} <b>{count}</b>
            </span>
          ))}
        </div>
      </footer>
    </aside>
  );
}
