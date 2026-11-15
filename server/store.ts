import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { DEFAULT_MODEL, type MediaFile } from "../shared/types";
import type { Collection, Store } from "./contracts";
import { InputError, idSchema, mediaSchema } from "./validation";

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const internals = new WeakMap<
  Store,
  { insertMedia: (media: MediaFile, bytes: Uint8Array) => MediaFile }
>();

export async function inspectImage(
  bytes: Uint8Array,
): Promise<Pick<MediaFile, "mime" | "width" | "height" | "size" | "sha256">> {
  if (!bytes.byteLength) throw new InputError("Image is empty");
  if (bytes.byteLength > MAX_MEDIA_BYTES)
    throw new InputError("Images must be at most 20 MiB", 413);
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10;
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;
  const isWebp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (!isPng && !isJpeg && !isWebp)
    throw new InputError("Only PNG, JPEG, and WebP images are accepted", 415);
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    const mime =
      metadata.format === "png"
        ? "image/png"
        : metadata.format === "jpeg"
          ? "image/jpeg"
          : metadata.format === "webp"
            ? "image/webp"
            : null;
    if (
      !mime ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 32768 ||
      metadata.height > 32768 ||
      metadata.width * metadata.height > MAX_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new InputError("Image dimensions or format are unsupported", 415);
    }
    await image.stats();
    return {
      mime,
      width: metadata.width,
      height: metadata.height,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("Image could not be decoded safely", 415);
  }
}

export function createStore(dataDir: string): Store {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const blobs = join(dataDir, "media");
  mkdirSync(blobs, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, "library.sqlite"), {
    create: true,
    strict: true,
  });
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL CHECK (collection IN ('references','designs','settings')),
      id TEXT NOT NULL,
      body TEXT NOT NULL CHECK (json_valid(body)),
      PRIMARY KEY (collection,id)
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL CHECK (json_valid(body))
    );
  `);
  const selectDocuments = db.query<{ body: string }, [string]>(
    "SELECT body FROM documents WHERE collection=? ORDER BY rowid",
  );
  const selectDocument = db.query<{ body: string }, [string, string]>(
    "SELECT body FROM documents WHERE collection=? AND id=?",
  );
  const putDocument = db.query(
    "INSERT INTO documents(collection,id,body) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body",
  );
  const deleteDocument = db.query(
    "DELETE FROM documents WHERE collection=? AND id=?",
  );
  const selectMedia = db.query<{ body: string }, [string]>(
    "SELECT body FROM media WHERE id=?",
  );
  const selectAllMedia = db.query<{ body: string }, []>(
    "SELECT body FROM media ORDER BY rowid",
  );
  const putMedia = db.query("INSERT INTO media(id,body) VALUES(?,?)");
  const fileTransactions: string[][] = [];

  const store: Store = {
    list<T>(collection: Collection): T[] {
      return selectDocuments
        .all(collection)
        .map((row) => JSON.parse(row.body) as T);
    },
    get<T>(collection: Collection, id: string): T | null {
      const row = selectDocument.get(collection, id);
      return row ? (JSON.parse(row.body) as T) : null;
    },
    put<T extends { id: string }>(collection: Collection, value: T): T {
      if (
        collection === "settings"
          ? value.id !== "main"
          : !idSchema.safeParse(value.id).success
      )
        throw new InputError("Invalid document ID");
      putDocument.run(collection, value.id, JSON.stringify(value));
      return value;
    },
    remove(collection: Collection, id: string): void {
      deleteDocument.run(collection, id);
    },
    listMedia(): MediaFile[] {
      return selectAllMedia
        .all()
        .map((row) => JSON.parse(row.body) as MediaFile);
    },
    getMedia(id: string): MediaFile | null {
      if (!idSchema.safeParse(id).success) return null;
      const row = selectMedia.get(id);
      return row ? (JSON.parse(row.body) as MediaFile) : null;
    },
    async mediaBytes(id: string): Promise<Uint8Array> {
      if (!store.getMedia(id)) throw new InputError("Image not found", 404);
      return readFileSync(join(blobs, `${id}.blob`));
    },
    async addMedia(bytes: Uint8Array, name: string): Promise<MediaFile> {
      const properties = await inspectImage(bytes);
      const cleanName =
        name
          .split(/[\\/]/)
          .pop()
          ?.replace(/[\u0000-\u001f\u007f]/g, "")
          .slice(0, 255) || "image";
      const media: MediaFile = {
        id: randomUUID(),
        name: cleanName,
        ...properties,
        createdAt: new Date().toISOString(),
      };
      return store.transaction(() => insertMedia(media, bytes));
    },
    transaction<T>(fn: () => T): T {
      const files: string[] = [];
      fileTransactions.push(files);
      try {
        const result = db.transaction(() => {
          const value = fn();
          if (
            value &&
            (typeof value === "object" || typeof value === "function") &&
            "then" in value &&
            typeof value.then === "function"
          )
            throw new Error("Store transactions must be synchronous");
          return value;
        })();
        fileTransactions.pop();
        fileTransactions.at(-1)?.push(...files);
        return result;
      } catch (error) {
        fileTransactions.pop();
        for (const path of files) rmSync(path, { force: true });
        throw error;
      }
    },
    close(): void {
      db.close();
    },
  };
  function insertMedia(media: MediaFile, bytes: Uint8Array): MediaFile {
    mediaSchema.parse(media);
    if (store.getMedia(media.id))
      throw new InputError("Media ID already exists", 409);
    const temporary = join(blobs, `${randomUUID()}.tmp`);
    const destination = join(blobs, `${media.id}.blob`);
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      renameSync(temporary, destination);
      fileTransactions.at(-1)?.push(destination);
      putMedia.run(media.id, JSON.stringify(media));
      return media;
    } catch (error) {
      rmSync(temporary, { force: true });
      rmSync(destination, { force: true });
      throw error;
    }
  }
  internals.set(store, { insertMedia });
  if (!store.get("settings", "main"))
    store.put("settings", { id: "main", model: DEFAULT_MODEL, consent: false });
  return store;
}

/** Callers inspect all images first; file creation and document writes commit together. */
export function atomicMediaImport<T>(
  store: Store,
  entries: { media: MediaFile; bytes: Uint8Array }[],
  apply: () => T,
): T {
  const internal = internals.get(store);
  if (!internal)
    throw new Error("Atomic media import requires a managed store");
  for (const entry of entries) mediaSchema.parse(entry.media);
  return store.transaction(() => {
    for (const entry of entries) internal.insertMedia(entry.media, entry.bytes);
    return apply();
  });
}
