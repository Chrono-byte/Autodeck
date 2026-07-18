export const MESSAGE_CHUNK_LENGTH = 200_000;

export function chunkSerializedMessage(serializedMessage: string) {
  const chunks: string[] = [];
  for (let offset = 0; offset < serializedMessage.length; offset += MESSAGE_CHUNK_LENGTH) {
    chunks.push(serializedMessage.slice(offset, offset + MESSAGE_CHUNK_LENGTH));
  }
  return chunks.length > 0 ? chunks : [""];
}

export function restoreSerializedMessages(
  chunks: Array<{ messageIndex: number; chunkIndex: number; content: string }>,
) {
  const messages = new Map<number, string[]>();
  for (const chunk of chunks) {
    const messageChunks = messages.get(chunk.messageIndex) ?? [];
    messageChunks[chunk.chunkIndex] = chunk.content;
    messages.set(chunk.messageIndex, messageChunks);
  }

  return [...messages.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, messageChunks]) => JSON.parse(messageChunks.join("")) as unknown);
}
