const MANA_SYNTAX = /\$\{([0-9A-Z/]{1,8}|∞|½)\}\$/gi;

const OFFICIAL_MANA_SYMBOLS = new Set([
  "X",
  "Y",
  "Z",
  "0",
  "HALF",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "100",
  "1000000",
  "INFINITY",
  "WU",
  "WB",
  "BR",
  "BG",
  "UB",
  "UR",
  "RG",
  "RW",
  "GW",
  "GU",
  "BGP",
  "BRP",
  "GUP",
  "GWP",
  "RGP",
  "RWP",
  "UBP",
  "URP",
  "WBP",
  "WUP",
  "CW",
  "CU",
  "CB",
  "CR",
  "CG",
  "2W",
  "2U",
  "2B",
  "2R",
  "2G",
  "H",
  "WP",
  "UP",
  "BP",
  "RP",
  "GP",
  "CP",
  "HW",
  "HR",
  "W",
  "U",
  "B",
  "R",
  "G",
  "C",
  "S",
  "L",
]);

export function manaAssetKey(symbol: string) {
  const normalized = symbol.toUpperCase().replaceAll("/", "");
  if (normalized === "½") return "HALF";
  if (normalized === "∞") return "INFINITY";
  return normalized;
}

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string | string[]>;
  };
};

function manaNode(symbol: string): MarkdownNode {
  return {
    type: "manaSymbol",
    data: {
      hName: "i",
      hProperties: {
        className: ["mana-symbol-placeholder"],
      },
    },
    children: [{ type: "text", value: symbol.toUpperCase() }],
  };
}

export function splitManaText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(MANA_SYNTAX)) {
    const index = match.index;
    const symbol = match[1];
    if (index === undefined || symbol === undefined) continue;
    if (!OFFICIAL_MANA_SYMBOLS.has(manaAssetKey(symbol))) continue;

    if (index > cursor) nodes.push({ type: "text", value: value.slice(cursor, index) });
    nodes.push(manaNode(symbol));
    cursor = index + match[0].length;
  }

  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length > 0 ? nodes : [{ type: "text", value }];
}

function transformManaNodes(node: MarkdownNode) {
  if (!node.children) return;

  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value?.includes("${")) {
      return splitManaText(child.value);
    }
    transformManaNodes(child);
    return [child];
  });
}

export function remarkManaSymbols() {
  return (tree: unknown) => {
    if (typeof tree !== "object" || tree === null || !("type" in tree)) return;
    transformManaNodes(tree as MarkdownNode);
  };
}
