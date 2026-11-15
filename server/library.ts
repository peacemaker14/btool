import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Inflate, zipSync } from "fflate";
import { z } from "zod";
import {
  DEFAULT_MODEL,
  newRecipe,
  type Design,
  type Inspiration,
  type LibraryState,
  type MediaFile,
  type Recipe,
  type RestoreReport,
  type Settings,
} from "../shared/types";
import type { Store } from "./contracts";
import { atomicMediaImport, inspectImage, MAX_MEDIA_BYTES } from "./store";
import {
  assertMedia,
  createDesignSchema,
  designSchema,
  idSchema,
  InputError,
  inspirationInputSchema,
  inspirationSchema,
  mediaSchema,
  recipeSchema,
  settingsSchema,
  updateDesignSchema,
  validateRecipe,
} from "./validation";

const MAX_BACKUP_BYTES = 160 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const manifestSchema = z
  .object({
    format: z.literal("btools-library"),
    formatVersion: z.literal(1),
    createdAt: z.iso.datetime(),
    references: z.array(inspirationSchema).max(10000),
    designs: z.array(designSchema).max(1000),
    media: z.array(mediaSchema).max(2000),
    settings: settingsSchema.optional(),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function localSettings(store: Store): Settings {
  const settings = store.get<Settings>("settings", "main");
  return {
    model: settings?.model ?? DEFAULT_MODEL,
    consent: settings?.consent ?? false,
  };
}

/** Inspect the central directory before allocating any decompressed entry. Never extract to disk. */
function readArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_BACKUP_BYTES)
    throw new InputError("Backup exceeds 160 MiB", 413);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new InputError("Invalid ZIP archive");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count < 1 ||
    count > 2001 ||
    directoryOffset + directorySize !== end
  )
    throw new InputError("Unsupported ZIP directory");
  const entries = new Map<
    string,
    {
      size: number;
      compressed: number;
      dataOffset: number;
      method: number;
      crc: number;
    }
  >();
  let offset = directoryOffset;
  let total = 0;
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new InputError("Invalid ZIP directory");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      view.getUint16(offset + 34, true) !== 0 ||
      localOffset + 30 > directoryOffset
    )
      throw new InputError("Unsupported ZIP entry");
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (name !== "manifest.json" && !/^media\/[0-9a-f-]{36}$/i.test(name))
      throw new InputError("Backup contains an unexpected or unsafe path");
    if (name.startsWith("media/") && !idSchema.safeParse(name.slice(6)).success)
      throw new InputError("Invalid media path");
    if (entries.has(name))
      throw new InputError("Backup contains duplicate paths");
    const limit =
      name === "manifest.json" ? MAX_MANIFEST_BYTES : MAX_MEDIA_BYTES;
    total += size;
    if (
      !size ||
      size > limit ||
      total > MAX_EXPANDED_BYTES ||
      compressed > MAX_BACKUP_BYTES
    )
      throw new InputError("Backup expands beyond the allowed size", 413);
    if (
      view.getUint32(localOffset, true) !== 0x04034b50 ||
      view.getUint16(localOffset + 8, true) !== method ||
      view.getUint16(localOffset + 6, true) & 1
    )
      throw new InputError("Invalid ZIP entry header");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (
      dataOffset + compressed > directoryOffset ||
      decoder.decode(
        bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      ) !== name
    )
      throw new InputError("Invalid ZIP entry bounds");
    entries.set(name, {
      size,
      compressed,
      dataOffset,
      method,
      crc: view.getUint32(offset + 16, true),
    });
    offset = next;
  }
  if (offset !== end || !entries.has("manifest.json"))
    throw new InputError("Backup manifest is missing");
  const archive: Record<string, Uint8Array> = {};
  try {
    for (const [name, entry] of entries) {
      const compressed = bytes.subarray(
        entry.dataOffset,
        entry.dataOffset + entry.compressed,
      );
      let output: Uint8Array;
      if (entry.method === 0) {
        if (entry.size !== entry.compressed)
          throw new InputError("ZIP entry size mismatch");
        output = compressed;
      } else {
        output = new Uint8Array(entry.size);
        let written = 0;
        let finished = false;
        const inflate = new Inflate((chunk, final) => {
          if (written + chunk.length > output.length)
            throw new InputError(
              "ZIP entry expands beyond its declared size",
              413,
            );
          output.set(chunk, written);
          written += chunk.length;
          finished = final;
        });
        // Bound each decoder step even when the archive lies about expanded size.
        for (let start = 0; start < compressed.length; start += 4096) {
          inflate.push(
            compressed.subarray(start, start + 4096),
            start + 4096 >= compressed.length,
          );
        }
        if (!finished || written !== entry.size)
          throw new InputError("ZIP entry size mismatch");
      }
      if (crc32(output) !== entry.crc)
        throw new InputError("ZIP entry checksum mismatch");
      archive[name] = output;
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("ZIP archive could not be decoded");
  }
  return archive;
}

function validateManifest(
  manifest: Manifest,
  archive: Record<string, Uint8Array>,
): void {
  const assertUnique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length)
      throw new InputError(`Backup has duplicate ${label} IDs`);
  };
  assertUnique(
    manifest.references.map((item) => item.id),
    "reference",
  );
  assertUnique(
    manifest.designs.map((item) => item.id),
    "design",
  );
  assertUnique(
    manifest.media.map((item) => item.id),
    "media",
  );
  assertUnique(
    manifest.references.flatMap((item) =>
      item.screenshots.map((screenshot) => screenshot.id),
    ),
    "screenshot",
  );
  assertUnique(
    manifest.designs.flatMap((item) =>
      item.versions.map((version) => version.id),
    ),
    "version",
  );
  const media = new Set(manifest.media.map((item) => item.id));
  if (Object.keys(archive).length !== media.size + 1)
    throw new InputError("Backup contains unlisted media");
  for (const item of manifest.media)
    if (!archive[`media/${item.id}`])
      throw new InputError("Backup image is missing");
  const screenshotOwners = new Map(
    manifest.references.flatMap((item) =>
      item.screenshots.map((screenshot) => [screenshot.id, item.id] as const),
    ),
  );
  for (const reference of manifest.references) {
    for (const screenshot of reference.screenshots)
      if (!media.has(screenshot.mediaId))
        throw new InputError("Reference image is missing from backup");
  }
  for (const design of manifest.designs) {
    for (const recipe of [
      design.recipe,
      ...design.versions.map((version) => version.recipe),
    ]) {
      for (const id of [
        ...recipe.assetIds,
        ...recipe.config.assets.map((asset) => asset.id),
      ])
        if (!media.has(id))
          throw new InputError("Recipe asset is missing from backup");
      for (const selection of recipe.references) {
        const owner = screenshotOwners.get(selection.screenshotId);
        if (owner && owner !== selection.referenceId)
          throw new InputError(
            "Recipe screenshot belongs to a different reference",
          );
      }
    }
  }
}

async function restore(
  store: Store,
  archive: Record<string, Uint8Array>,
): Promise<RestoreReport> {
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        archive["manifest.json"],
      ),
    );
  } catch {
    throw new InputError("Backup manifest is not valid JSON");
  }
  const manifest = manifestSchema.parse(raw);
  validateManifest(manifest, archive);
  // Decode even duplicate images before any database or filesystem mutation.
  for (const media of manifest.media) {
    const actual = await inspectImage(archive[`media/${media.id}`]!);
    if (
      actual.sha256 !== media.sha256 ||
      actual.mime !== media.mime ||
      actual.width !== media.width ||
      actual.height !== media.height ||
      actual.size !== media.size
    )
      throw new InputError("Backup image metadata does not match its bytes");
  }
  const report: RestoreReport = {
    references: 0,
    designs: 0,
    media: 0,
    duplicates: 0,
    conflicts: 0,
  };
  const mediaIds = new Map<string, string>();
  const referenceIds = new Map<string, string>();
  const screenshotIds = new Map<string, string>();
  const existingReferences = store.list<Inspiration>("references");
  const existingDesigns = store.list<Design>("designs");
  const usedScreenshots = new Set(
    existingReferences.flatMap((item) =>
      item.screenshots.map((screenshot) => screenshot.id),
    ),
  );
  const usedVersions = new Set(
    existingDesigns.flatMap((item) =>
      item.versions.map((version) => version.id),
    ),
  );
  const mediaEntries: { media: MediaFile; bytes: Uint8Array }[] = [];
  for (const media of manifest.media) {
    const existing = store.getMedia(media.id);
    if (existing && canonical(existing) === canonical(media)) {
      mediaIds.set(media.id, media.id);
      report.duplicates++;
      continue;
    }
    const id = existing ? randomUUID() : media.id;
    if (existing) report.conflicts++;
    mediaIds.set(media.id, id);
    mediaEntries.push({
      media: { ...media, id },
      bytes: archive[`media/${media.id}`]!,
    });
    report.media++;
  }
  const references: Inspiration[] = [];
  for (const reference of manifest.references) {
    const candidate = {
      ...reference,
      screenshots: reference.screenshots.map((screenshot) => ({
        ...screenshot,
        mediaId: mediaIds.get(screenshot.mediaId)!,
      })),
    };
    const existing = store.get<Inspiration>("references", reference.id);
    if (existing && canonical(existing) === canonical(candidate)) {
      referenceIds.set(reference.id, reference.id);
      for (const screenshot of reference.screenshots)
        screenshotIds.set(screenshot.id, screenshot.id);
      report.duplicates++;
      continue;
    }
    const id = existing ? randomUUID() : reference.id;
    if (existing) report.conflicts++;
    referenceIds.set(reference.id, id);
    candidate.id = id;
    candidate.screenshots = candidate.screenshots.map((screenshot) => {
      const screenshotId =
        existing || usedScreenshots.has(screenshot.id)
          ? randomUUID()
          : screenshot.id;
      screenshotIds.set(screenshot.id, screenshotId);
      usedScreenshots.add(screenshotId);
      return { ...screenshot, id: screenshotId };
    });
    references.push(candidate);
    report.references++;
  }
  // Deleted library references are valid historical selections. Isolate their IDs
  // from unrelated local records without inventing replacement reference records.
  for (const design of manifest.designs) {
    for (const recipe of [
      design.recipe,
      ...design.versions.map((version) => version.recipe),
    ]) {
      for (const selection of recipe.references) {
        if (!referenceIds.has(selection.referenceId))
          referenceIds.set(
            selection.referenceId,
            store.get("references", selection.referenceId)
              ? randomUUID()
              : selection.referenceId,
          );
        if (!screenshotIds.has(selection.screenshotId))
          screenshotIds.set(
            selection.screenshotId,
            usedScreenshots.has(selection.screenshotId)
              ? randomUUID()
              : selection.screenshotId,
          );
      }
    }
  }
  const remapRecipe = (recipe: Recipe): Recipe => ({
    ...recipe,
    references: recipe.references.map((selection) => ({
      ...selection,
      referenceId: referenceIds.get(selection.referenceId)!,
      screenshotId: screenshotIds.get(selection.screenshotId)!,
    })),
    assetIds: recipe.assetIds.map((id) => mediaIds.get(id)!),
    config: {
      ...recipe.config,
      assets: recipe.config.assets.map((asset) => {
        const id = mediaIds.get(asset.id)!;
        return { ...asset, id, src: `/api/media/${id}` };
      }),
    },
  });
  const designs: Design[] = [];
  for (const design of manifest.designs) {
    const candidate: Design = {
      ...design,
      recipe: remapRecipe(design.recipe),
      versions: design.versions.map((version) => ({
        ...version,
        recipe: remapRecipe(version.recipe),
        code: version.code.replace(
          /\/api\/media\/([0-9a-f-]{36})/gi,
          (url, id: string) =>
            mediaIds.has(id) ? `/api/media/${mediaIds.get(id)!}` : url,
        ),
      })),
    };
    const existing = store.get<Design>("designs", design.id);
    if (existing && canonical(existing) === canonical(candidate)) {
      report.duplicates++;
      continue;
    }
    if (existing) {
      candidate.id = randomUUID();
      report.conflicts++;
    }
    const versions = new Map<string, string>();
    candidate.versions = candidate.versions.map((version) => {
      const id =
        existing || usedVersions.has(version.id) ? randomUUID() : version.id;
      versions.set(version.id, id);
      usedVersions.add(id);
      return { ...version, id };
    });
    candidate.currentVersionId = candidate.currentVersionId
      ? versions.get(candidate.currentVersionId)!
      : null;
    designs.push(candidate);
    report.designs++;
  }
  return atomicMediaImport(store, mediaEntries, () => {
    for (const reference of references) store.put("references", reference);
    for (const design of designs) store.put("designs", design);
    return report;
  });
}

export function createLibraryRoutes(store: Store): Hono {
  const app = new Hono();
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BACKUP_BYTES,
      onError: (c) => c.json({ error: "Request exceeds 160 MiB" }, 413),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof InputError)
      return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: error.issues
            .map(
              (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
            )
            .join("; ")
            .slice(0, 2000),
        },
        400,
      );
    if (error instanceof SyntaxError)
      return c.json({ error: "Invalid JSON request" }, 400);
    return c.json(
      { error: "The library operation could not be completed" },
      500,
    );
  });
  app.get("/state", (c) => {
    const state: LibraryState = {
      references: store.list("references"),
      designs: store.list("designs"),
      media: store.listMedia(),
      settings: localSettings(store),
    };
    return c.json(state);
  });
  app.post("/media", async (c) => {
    const form = await c.req.formData().catch(() => {
      throw new InputError("Expected a valid multipart upload");
    });
    const files: unknown[] = [...form.values()];
    if (
      !files.length ||
      files.length > 20 ||
      files.some((file) => !(file instanceof File))
    )
      throw new InputError("Upload between 1 and 20 image files");
    const entries: { media: MediaFile; bytes: Uint8Array }[] = [];
    for (const value of files) {
      if (!(value instanceof File))
        throw new InputError("Upload must contain image files");
      if (value.size > MAX_MEDIA_BYTES)
        throw new InputError("Images must be at most 20 MiB", 413);
      const bytes = new Uint8Array(await value.arrayBuffer());
      const properties = await inspectImage(bytes);
      const name =
        value.name
          .split(/[\\/]/)
          .pop()
          ?.replace(/[\u0000-\u001f\u007f]/g, "")
          .slice(0, 255) || "image";
      entries.push({
        media: {
          id: randomUUID(),
          name,
          ...properties,
          createdAt: new Date().toISOString(),
        },
        bytes,
      });
    }
    const media = await atomicMediaImport(store, entries, () =>
      entries.map((entry) => entry.media),
    );
    return c.json(media, 201);
  });
  app.get("/media/:id", async (c) => {
    const media = store.getMedia(c.req.param("id"));
    if (!media) throw new InputError("Image not found", 404);
    return c.body((await store.mediaBytes(media.id)) as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": media.mime,
      "Content-Length": String(media.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  });
  const saveReference = async (
    input: unknown,
    existing?: Inspiration,
  ): Promise<Inspiration> => {
    const parsed = inspirationInputSchema.parse(input);
    assertMedia(
      store,
      parsed.screenshots.map((screenshot) => screenshot.mediaId),
    );
    const used = new Set(
      store
        .list<Inspiration>("references")
        .filter((reference) => reference.id !== existing?.id)
        .flatMap((reference) =>
          reference.screenshots.map((screenshot) => screenshot.id),
        ),
    );
    if (
      parsed.screenshots.some(
        (screenshot) => screenshot.id && used.has(screenshot.id),
      )
    )
      throw new InputError(
        "Screenshot ID already belongs to another reference",
      );
    const now = new Date().toISOString();
    const reference: Inspiration = {
      ...parsed,
      id: existing?.id ?? randomUUID(),
      screenshots: parsed.screenshots.map((screenshot) => ({
        ...screenshot,
        id: screenshot.id ?? randomUUID(),
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return store.put("references", reference);
  };
  app.post("/references", async (c) =>
    c.json(await saveReference(await c.req.json()), 201),
  );
  app.put("/references/:id", async (c) => {
    const reference = store.get<Inspiration>("references", c.req.param("id"));
    if (!reference) throw new InputError("Reference not found", 404);
    return c.json(await saveReference(await c.req.json(), reference));
  });
  app.delete("/references/:id", (c) => {
    if (!store.get("references", c.req.param("id")))
      throw new InputError("Reference not found", 404);
    store.remove("references", c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/designs", async (c) => {
    const input = createDesignSchema.parse(await c.req.json());
    const recipe = input.recipe
      ? validateRecipe(store, input.recipe)
      : newRecipe();
    const now = new Date().toISOString();
    const design: Design = {
      id: randomUUID(),
      name: input.name ?? recipe.name,
      recipe,
      versions: [],
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    return c.json(store.put("designs", design), 201);
  });
  app.put("/designs/:id", async (c) => {
    const design = store.get<Design>("designs", c.req.param("id"));
    if (!design) throw new InputError("Design not found", 404);
    const input = updateDesignSchema.parse(await c.req.json());
    if (input.recipe && input.currentVersionId)
      throw new InputError(
        "Choose a recipe update or a historical version, not both",
      );
    let recipe = input.recipe
      ? recipeSchema.parse(input.recipe)
      : design.recipe;
    assertMedia(store, recipe.assetIds);
    let currentVersionId =
      input.currentVersionId === undefined
        ? design.currentVersionId
        : input.currentVersionId;
    if (input.currentVersionId) {
      const version = design.versions.find(
        (item) => item.id === input.currentVersionId,
      );
      if (!version) throw new InputError("Version not found", 404);
      recipe = structuredClone(version.recipe);
    }
    const updated: Design = {
      ...design,
      name: input.name ?? design.name,
      recipe,
      currentVersionId,
      updatedAt: new Date().toISOString(),
    };
    return c.json(store.put("designs", updated));
  });
  app.delete("/designs/:id", (c) => {
    if (!store.get("designs", c.req.param("id")))
      throw new InputError("Design not found", 404);
    store.remove("designs", c.req.param("id"));
    return c.json({ ok: true });
  });
  app.put("/settings", async (c) => {
    const settings = settingsSchema.parse(await c.req.json());
    store.put("settings", { ...settings, id: "main" });
    return c.json(settings);
  });
  app.get("/backup", async (c) => {
    const manifest: Manifest = {
      format: "btools-library",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      references: store.list("references"),
      designs: store.list("designs"),
      media: store.listMedia(),
      settings: localSettings(store),
    };
    const files: Record<string, Uint8Array> = {
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    };
    let total = files["manifest.json"]!.byteLength;
    if (total > MAX_MANIFEST_BYTES || manifest.media.length > 2000)
      throw new InputError(
        "Library exceeds the portable backup size limit",
        413,
      );
    for (const media of manifest.media) {
      total += media.size;
      if (total > MAX_EXPANDED_BYTES)
        throw new InputError(
          "Library exceeds the portable backup size limit",
          413,
        );
      files[`media/${media.id}`] = await store.mediaBytes(media.id);
    }
    const bytes = zipSync(files, { level: 0 });
    if (bytes.byteLength > MAX_BACKUP_BYTES)
      throw new InputError(
        "Library exceeds the portable backup size limit",
        413,
      );
    return c.body(bytes, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="btools-backup.zip"',
      "X-Content-Type-Options": "nosniff",
    });
  });
  app.post("/restore", async (c) => {
    const form = await c.req.formData().catch(() => {
      throw new InputError("Expected a valid multipart upload");
    });
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      form.getAll("file").length !== 1 ||
      [...form.keys()].some((key) => key !== "file")
    )
      throw new InputError("Provide one backup in the file field");
    if (file.size > MAX_BACKUP_BYTES)
      throw new InputError("Backup exceeds 160 MiB", 413);
    const archive = readArchive(new Uint8Array(await file.arrayBuffer()));
    return c.json(await restore(store, archive));
  });
  return app;
}
