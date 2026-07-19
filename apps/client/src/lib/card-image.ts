export type CardImageVersion = "normal" | "art_crop";

export function cardImageUrl(name: string, version: CardImageVersion) {
  const parameters = new URLSearchParams({ name, version });
  return `/api/cards/images?${parameters.toString()}`;
}
