export const INLINE_MESSAGE_LENGTH = 200_000;
export const MESSAGE_CHUNK_LENGTH = 200_000;
export const MAX_SERIALIZED_MESSAGE_LENGTH = 8_000_000;

export function chunkMessagePayload(serializedPayload: string) {
  if (serializedPayload.length > MAX_SERIALIZED_MESSAGE_LENGTH) {
    throw new Error("A single message is too large to persist");
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < serializedPayload.length; offset += MESSAGE_CHUNK_LENGTH) {
    chunks.push(serializedPayload.slice(offset, offset + MESSAGE_CHUNK_LENGTH));
  }
  return chunks;
}

export function restoreMessagePayload(
  inlinePayload: string | undefined,
  chunks: Array<{ chunkIndex: number; content: string }>,
) {
  if (inlinePayload !== undefined) return inlinePayload;
  return [...chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => chunk.content)
    .join("");
}
