const MAX_TITLE_LENGTH = 64;

export function cleanGeneratedThreadTitle(value: string) {
  const firstLine = value
    .split(/\r?\n/, 1)[0]
    ?.replace(/^\s*(?:title\s*:\s*)?/i, "")
    .replace(/^\s*["'`*_#]+|["'`*_#]+\s*$/g, "")
    .replace(/[.!?;:,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!firstLine) return "New conversation";
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine;

  const shortened = firstLine.slice(0, MAX_TITLE_LENGTH + 1);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 32 ? lastSpace : MAX_TITLE_LENGTH).trim()}…`;
}
