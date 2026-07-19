import { useState, type CSSProperties } from "react";
import { manaAssetKey } from "../lib/mana-markdown";

const MANA_COLORS: Record<string, string> = {
  W: "#f4f0d5",
  U: "#84c6e8",
  B: "#8c8490",
  R: "#e47a5f",
  G: "#78b88a",
  C: "#c5c8c6",
  S: "#b9d9e8",
  X: "#aaa7a0",
  Y: "#aaa7a0",
  Z: "#aaa7a0",
  P: "#9b655f",
};

function manaParts(symbol: string) {
  if (/^\d+$/.test(symbol)) return ["C"];
  return symbol.replaceAll("/", "").split("");
}

function manaBackground(symbol: string) {
  const colors = manaParts(symbol).map((part) => MANA_COLORS[part] ?? MANA_COLORS.C);
  if (colors.length === 1) return colors[0];
  if (colors.length === 2) {
    return `linear-gradient(135deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  }
  const stops = colors.flatMap((color, index) => {
    const start = (index / colors.length) * 100;
    const end = ((index + 1) / colors.length) * 100;
    return [`${color} ${start}%`, `${color} ${end}%`];
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function ManaSymbol({ symbol, className = "" }: { symbol: string; className?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalized = symbol.toUpperCase();
  const compact = normalized.replaceAll("/", "");
  const label = /^\d+$/.test(normalized) ? normalized : compact;
  const style: CSSProperties = { background: manaBackground(normalized) };
  const accessibleLabel = `${normalized} mana`;
  const classes = `mana-symbol ${className}`.trim();

  if (!imageFailed) {
    return (
      <img
        className={`${classes} mana-symbol-image`}
        src={`/mana/${manaAssetKey(normalized)}.svg`}
        alt={accessibleLabel}
        title={accessibleLabel}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`${classes} mana-symbol-fallback ${label.length > 1 ? "mana-symbol-complex" : ""}`}
      style={style}
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
