import { canOccupyCommandZone } from "./commander-validation";

export type LocalDeckSearchCard = {
  name: string;
  quantity: number;
  zone: "commander" | "main" | "maybeboard";
  typeLine: string;
  oracleText?: string;
  manaValue: number;
  colorIdentity: string[];
  oracleId?: string;
  oracleTags?: string[];
  tags: string[];
};

type Token = { type: "word" | "left" | "right" | "or"; value: string };
type QueryNode =
  | { type: "predicate"; value: string }
  | { type: "not"; child: QueryNode }
  | { type: "and" | "or"; children: QueryNode[] };

export type LocalScryfallQueryContext = {
  oracleTagsById?: ReadonlyMap<string, ReadonlySet<string>>;
};

const SUPPORTED_OPERATORS = [
  "name/n",
  "type/t",
  "oracle/o",
  "identity/id",
  "commander",
  "mana value/mv/cmc",
  "otag/oracletag",
  "is",
  "zone",
  "decktag",
].join(", ");

const SUPPORTED_IS_VALUES = new Set([
  "commander",
  "land",
  "creature",
  "permanent",
  "spell",
  "multicolored",
  "colorless",
]);

function tokenize(query: string) {
  const tokens: Token[] = [];
  let word = "";
  let quoted = false;
  let regex = false;
  let escaped = false;

  const pushWord = () => {
    const value = word.trim();
    if (value) tokens.push({ type: /^or$/i.test(value) ? "or" : "word", value });
    word = "";
  };

  for (const character of query.trim()) {
    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && (quoted || regex)) {
      escaped = true;
      word += character;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      word += character;
      continue;
    }
    if (character === "/" && !quoted) {
      regex = !regex;
      word += character;
      continue;
    }
    if (!quoted && !regex && (character === "(" || character === ")")) {
      pushWord();
      tokens.push({ type: character === "(" ? "left" : "right", value: character });
      continue;
    }
    if (!quoted && !regex && /\s/.test(character)) {
      pushWord();
      continue;
    }
    word += character;
  }
  if (quoted) throw new Error("Unterminated quote in local Scryfall query.");
  if (regex) throw new Error("Unterminated regular expression in local Scryfall query.");
  pushWord();
  return tokens;
}

class QueryParser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse() {
    if (this.tokens.length === 0) throw new Error("The local Scryfall query cannot be empty.");
    const node = this.parseOr();
    if (this.position !== this.tokens.length) {
      throw new Error(`Unexpected token "${this.tokens[this.position]?.value}".`);
    }
    return node;
  }

  private parseOr(): QueryNode {
    const children = [this.parseAnd()];
    while (this.tokens[this.position]?.type === "or") {
      this.position += 1;
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  private parseAnd(): QueryNode {
    const children: QueryNode[] = [];
    while (
      this.position < this.tokens.length &&
      this.tokens[this.position]?.type !== "right" &&
      this.tokens[this.position]?.type !== "or"
    ) {
      children.push(this.parseUnary());
    }
    if (children.length === 0) throw new Error("Expected a search term.");
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  private parseUnary(): QueryNode {
    const token = this.tokens[this.position];
    if (token?.type === "word" && token.value === "-") {
      this.position += 1;
      return { type: "not", child: this.parseUnary() };
    }
    if (token?.type === "word" && token.value.startsWith("-") && token.value.length > 1) {
      this.position += 1;
      return { type: "not", child: { type: "predicate", value: token.value.slice(1) } };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    const token = this.tokens[this.position];
    if (!token) throw new Error("Expected a search term.");
    if (token.type === "left") {
      this.position += 1;
      const child = this.parseOr();
      if (this.tokens[this.position]?.type !== "right") {
        throw new Error("Missing closing parenthesis in local Scryfall query.");
      }
      this.position += 1;
      return child;
    }
    if (token.type !== "word") throw new Error(`Unexpected token "${token.value}".`);
    this.position += 1;
    return { type: "predicate", value: token.value };
  }
}

function unquote(value: string) {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replaceAll('\\"', '"')
    : value;
}

function matchesText(haystack: string | undefined, needle: string) {
  if (!haystack) return false;
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function compareNumber(actual: number, operator: string, rawExpected: string) {
  const expected = Number(rawExpected);
  if (!Number.isFinite(expected)) throw new Error(`Invalid numeric value "${rawExpected}".`);
  if (operator === "<") return actual < expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === ">=") return actual >= expected;
  if (operator === "!=") return actual !== expected;
  return actual === expected;
}

function colorSet(value: string) {
  const normalized = value.toUpperCase();
  if (/^(?:C|COLORLESS)$/.test(normalized)) return new Set<string>();
  if (!/^[WUBRG]+$/.test(normalized)) throw new Error(`Invalid color identity "${value}".`);
  return new Set(normalized);
}

function compareIdentity(actualColors: string[], operator: string, rawExpected: string) {
  const actual = new Set(actualColors);
  const expected = colorSet(rawExpected);
  const actualWithinExpected = [...actual].every((color) => expected.has(color));
  const expectedWithinActual = [...expected].every((color) => actual.has(color));
  if (operator === "<") return actualWithinExpected && actual.size < expected.size;
  if (operator === "<=") return actualWithinExpected;
  if (operator === ">") return expectedWithinActual && actual.size > expected.size;
  if (operator === ">=") return expectedWithinActual;
  const equal = actual.size === expected.size && actualWithinExpected;
  return operator === "!=" ? !equal : equal;
}

function isPredicate(card: LocalDeckSearchCard, value: string) {
  if (value === "commander") return canOccupyCommandZone(card);
  if (value === "land") return /\bland\b/i.test(card.typeLine);
  if (value === "creature") return /\bcreature\b/i.test(card.typeLine);
  if (value === "permanent") {
    return /\b(?:artifact|battle|creature|enchantment|land|planeswalker)\b/i.test(card.typeLine);
  }
  if (value === "spell") return !/\bland\b/i.test(card.typeLine);
  if (value === "multicolored") return card.colorIdentity.length > 1;
  if (value === "colorless") return card.colorIdentity.length === 0;
  throw new Error(`Unsupported local is: value "${value}".`);
}

function predicateParts(rawPredicate: string) {
  if (rawPredicate.startsWith('!"') && rawPredicate.endsWith('"')) {
    return { operatorName: "exact-name", operator: "=", value: unquote(rawPredicate.slice(1)) };
  }

  const match = rawPredicate.match(/^([a-z]+)(<=|>=|!=|:|=|<|>)(.+)$/i);
  if (!match) return { operatorName: "name", operator: ":", value: unquote(rawPredicate) };
  const [, rawOperatorName, operator, rawValue] = match;
  return {
    operatorName: rawOperatorName.toLocaleLowerCase(),
    operator,
    value: unquote(rawValue).toLocaleLowerCase(),
  };
}

function requireOperator(operatorName: string, operator: string, allowed: string[]) {
  if (allowed.includes(operator)) return;
  throw new Error(
    `Unsupported ${operatorName} operator "${operator}". Supported comparisons: ${allowed.join(", ")}.`,
  );
}

function validatePredicate(rawPredicate: string) {
  const { operatorName, operator, value } = predicateParts(rawPredicate);
  if (value.startsWith("/") && value.endsWith("/")) {
    throw new Error(
      "Regular expressions are not supported by local deck search; use text or a quoted phrase.",
    );
  }
  if (operatorName === "exact-name") return;
  if (["name", "n", "type", "t", "oracle", "o"].includes(operatorName)) {
    requireOperator(operatorName, operator, [":", "=", "!="]);
    return;
  }
  if (["mv", "cmc"].includes(operatorName)) {
    compareNumber(0, operator, value);
    return;
  }
  if (["identity", "id"].includes(operatorName)) {
    colorSet(value);
    return;
  }
  if (operatorName === "commander") {
    requireOperator(operatorName, operator, [":", "=", "!="]);
    colorSet(value);
    return;
  }
  if (["otag", "oracletag", "decktag"].includes(operatorName)) {
    requireOperator(operatorName, operator, [":", "=", "!="]);
    return;
  }
  if (operatorName === "is") {
    requireOperator(operatorName, operator, [":", "=", "!="]);
    if (!SUPPORTED_IS_VALUES.has(value)) {
      throw new Error(`Unsupported local is: value "${value}".`);
    }
    return;
  }
  if (operatorName === "zone") {
    requireOperator(operatorName, operator, [":", "=", "!="]);
    if (!(["commander", "main", "maybeboard"] as string[]).includes(value)) {
      throw new Error(`Unsupported local zone: value "${value}".`);
    }
    return;
  }
  throw new Error(
    `Unsupported local Scryfall operator "${operatorName}". Supported operators: ${SUPPORTED_OPERATORS}.`,
  );
}

function validateQuery(node: QueryNode): void {
  if (node.type === "predicate") {
    validatePredicate(node.value);
    return;
  }
  if (node.type === "not") {
    validateQuery(node.child);
    return;
  }
  for (const child of node.children) validateQuery(child);
}

function equalityResult(matches: boolean, operator: string) {
  return operator === "!=" ? !matches : matches;
}

function matchesPredicate(
  card: LocalDeckSearchCard,
  rawPredicate: string,
  context: LocalScryfallQueryContext,
) {
  const { operatorName, operator, value } = predicateParts(rawPredicate);

  if (operatorName === "exact-name") {
    return card.name.toLocaleLowerCase() === value.toLocaleLowerCase();
  }
  if (operatorName === "name" || operatorName === "n") {
    return equalityResult(matchesText(card.name, value), operator);
  }
  if (operatorName === "type" || operatorName === "t") {
    return equalityResult(matchesText(card.typeLine, value), operator);
  }
  if (operatorName === "oracle" || operatorName === "o") {
    return equalityResult(matchesText(card.oracleText, value), operator);
  }
  if (operatorName === "mv" || operatorName === "cmc") {
    return compareNumber(card.manaValue, operator, value);
  }
  if (operatorName === "identity" || operatorName === "id") {
    return compareIdentity(card.colorIdentity, operator, value);
  }
  if (operatorName === "commander") {
    return compareIdentity(card.colorIdentity, operator === "!=" ? "!=" : "<=", value);
  }
  if (operatorName === "otag" || operatorName === "oracletag") {
    const storedMatch = card.oracleTags?.some((tag) => tag.toLocaleLowerCase() === value) ?? false;
    const indexedMatch = card.oracleId
      ? (context.oracleTagsById?.get(card.oracleId)?.has(value) ?? false)
      : false;
    return equalityResult(storedMatch || indexedMatch, operator);
  }
  if (operatorName === "is") return equalityResult(isPredicate(card, value), operator);
  if (operatorName === "zone") return equalityResult(card.zone === value, operator);
  if (operatorName === "decktag") {
    return equalityResult(
      card.tags.some((tag) => tag.toLocaleLowerCase() === value),
      operator,
    );
  }
  throw new Error(
    `Unsupported local Scryfall operator "${operatorName}". Supported operators: ${SUPPORTED_OPERATORS}.`,
  );
}

function evaluate(
  node: QueryNode,
  card: LocalDeckSearchCard,
  context: LocalScryfallQueryContext,
): boolean {
  if (node.type === "predicate") return matchesPredicate(card, node.value, context);
  if (node.type === "not") return !evaluate(node.child, card, context);
  if (node.type === "and") return node.children.every((child) => evaluate(child, card, context));
  return node.children.some((child) => evaluate(child, card, context));
}

export function queryUsesOracleTags(query: string) {
  return /(?:^|[\s(])-?(?:otag|oracletag)(?::|=)/i.test(query);
}

export function searchLocalDeck(
  cards: LocalDeckSearchCard[],
  query: string,
  context: LocalScryfallQueryContext = {},
) {
  const root = new QueryParser(tokenize(query)).parse();
  validateQuery(root);
  return cards.filter((card) => evaluate(root, card, context));
}
