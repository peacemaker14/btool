import type { MediaFile } from "../shared/types";
export type Collection = "references" | "designs" | "settings";
export interface Store {
  list<T>(collection: Collection): T[];
  get<T>(collection: Collection, id: string): T | null;
  put<T extends { id: string }>(collection: Collection, value: T): T;
  remove(collection: Collection, id: string): void;
  listMedia(): MediaFile[];
  getMedia(id: string): MediaFile | null;
  mediaBytes(id: string): Promise<Uint8Array>;
  addMedia(bytes: Uint8Array, name: string): Promise<MediaFile>;
  transaction<T>(fn: () => T): T;
  close(): void;
}
