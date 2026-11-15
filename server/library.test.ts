import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import type { Hono } from "hono";
import sharp from "sharp";
import {
  newRecipe,
  type Design,
  type Inspiration,
  type RestoreReport,
} from "../shared/types";
import type { Store } from "./contracts";
import { createLibraryRoutes } from "./library";
import { atomicMediaImport, createStore } from "./store";

const fixtures: { store: Store; directory: string }[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "btools-library-"));
  const store = createStore(directory);
  fixtures.push({ store, directory });
  return { store, directory, app: createLibraryRoutes(store) };
}
async function seed(store: Store) {
  const bytes = await sharp({
    create: { width: 2, height: 3, channels: 4, background: "#a7472b" },
  })
    .png()
    .toBuffer();
  const media = await store.addMedia(bytes, "../../reference.png");
  const now = new Date().toISOString();
  const reference: Inspiration = {
    id: randomUUID(),
    title: "Reference",
    url: "",
    notes: "",
    pageType: "",
    componentTypes: [],
    tags: ["warm"],
    screenshots: [
      {
        id: randomUUID(),
        mediaId: media.id,
        caption: "",
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  store.put("references", reference);
  const recipe = newRecipe();
  recipe.references = [
    {
      referenceId: reference.id,
      screenshotId: reference.screenshots[0]!.id,
      role: "layout",
      useCrop: true,
    },
  ];
  recipe.assetIds = [media.id];
  recipe.config.assets = [
    { id: media.id, name: "Owned asset", src: `/api/media/${media.id}` },
  ];
  const versionId = randomUUID();
  const design: Design = {
    id: randomUUID(),
    name: "Saved design",
    recipe,
    versions: [
      {
        id: versionId,
        createdAt: now,
        label: "First",
        code: `export default function App(){return <img src="/api/media/${media.id}" />}`,
        recipe: structuredClone(recipe),
      },
    ],
    currentVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  };
  store.put("designs", design);
  return { media, bytes, reference, design };
}
async function importBackup(app: Hono, bytes: Uint8Array) {
  const form = new FormData();
  form.set(
    "file",
    new File([Uint8Array.from(bytes)], "backup.zip", {
      type: "application/zip",
    }),
  );
  return app.request("/restore", { method: "POST", body: form });
}

test("images use validated raster bytes, safe names, UUID blobs and immutable response headers", async () => {
  const { store, app, directory } = fixture();
  const { media, bytes } = await seed(store);
  expect(media).toMatchObject({
    name: "reference.png",
    width: 2,
    height: 3,
    mime: "image/png",
    size: bytes.length,
  });
  expect(media.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(readdirSync(join(directory, "media"))).toEqual([`${media.id}.blob`]);
  const response = await app.request(`/media/${media.id}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array(bytes),
  );
  await expect(
    store.addMedia(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "image.png",
    ),
  ).rejects.toThrow("Only PNG");
});

test("invalid crop and empty references are rejected; deleting references preserves version snapshots", async () => {
  const { store, app } = fixture();
  const { reference, design } = await seed(store);
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    ...input
  } = reference;
  const invalidCrop = await app.request("/references", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      screenshots: [
        {
          ...input.screenshots[0],
          crop: { x: 0.8, y: 0, width: 0.5, height: 1 },
        },
      ],
    }),
  });
  expect(invalidCrop.status).toBe(400);
  const empty = await app.request("/references", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, screenshots: [] }),
  });
  expect(empty.status).toBe(400);
  expect(
    (await app.request(`/references/${reference.id}`, { method: "DELETE" }))
      .status,
  ).toBe(200);
  expect(store.get<Design>("designs", design.id)).toEqual(design);
  const edited = {
    ...design,
    recipe: { ...design.recipe, instructions: "Different current recipe" },
    currentVersionId: null,
  };
  store.put("designs", edited);
  const restored = await app.request(`/designs/${design.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentVersionId: design.currentVersionId }),
  });
  expect(restored.status).toBe(200);
  expect(store.get<Design>("designs", design.id)?.recipe).toEqual(
    design.versions[0]!.recipe,
  );
});

test("backup restore skips identical records and never imports model consent", async () => {
  const source = fixture();
  await seed(source.store);
  source.store.put("settings", {
    id: "main",
    model: "remote/model",
    consent: true,
  });
  const backup = new Uint8Array(
    await (await source.app.request("/backup")).arrayBuffer(),
  );
  const target = fixture();
  target.store.put("settings", {
    id: "main",
    model: "local/model",
    consent: false,
  });
  const first = await importBackup(target.app, backup);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({
    references: 1,
    designs: 1,
    media: 1,
    duplicates: 0,
    conflicts: 0,
  });
  const second = await importBackup(target.app, backup);
  expect(await second.json()).toEqual({
    references: 0,
    designs: 0,
    media: 0,
    duplicates: 3,
    conflicts: 0,
  });
  expect(target.store.get("settings", "main")).toEqual({
    id: "main",
    model: "local/model",
    consent: false,
  });
});

test("conflicting imports preserve local data and remap every recipe, asset, version and screenshot link", async () => {
  const source = fixture();
  const data = await seed(source.store);
  const backup = new Uint8Array(
    await (await source.app.request("/backup")).arrayBuffer(),
  );
  const target = fixture();
  atomicMediaImport(
    target.store,
    [{ media: { ...data.media, name: "local.png" }, bytes: data.bytes }],
    () => {
      target.store.put("references", {
        ...data.reference,
        title: "Local reference",
      });
      target.store.put("designs", { ...data.design, name: "Local design" });
    },
  );
  const response = await importBackup(target.app, backup);
  expect(response.status).toBe(200);
  const report = (await response.json()) as RestoreReport;
  expect(report).toEqual({
    references: 1,
    designs: 1,
    media: 1,
    duplicates: 0,
    conflicts: 3,
  });
  const importedReference = target.store
    .list<Inspiration>("references")
    .find((item) => item.id !== data.reference.id)!;
  const importedDesign = target.store
    .list<Design>("designs")
    .find((item) => item.id !== data.design.id)!;
  const importedMedia = target.store
    .listMedia()
    .find((item) => item.id !== data.media.id)!;
  expect(importedReference.screenshots[0]!.id).not.toBe(
    data.reference.screenshots[0]!.id,
  );
  expect(importedReference.screenshots[0]!.mediaId).toBe(importedMedia.id);
  for (const recipe of [
    importedDesign.recipe,
    ...importedDesign.versions.map((version) => version.recipe),
  ]) {
    expect(recipe.references[0]).toMatchObject({
      referenceId: importedReference.id,
      screenshotId: importedReference.screenshots[0]!.id,
    });
    expect(recipe.assetIds).toEqual([importedMedia.id]);
    expect(recipe.config.assets[0]).toMatchObject({
      id: importedMedia.id,
      src: `/api/media/${importedMedia.id}`,
    });
  }
  expect(importedDesign.currentVersionId).toBe(importedDesign.versions[0]!.id);
  expect(importedDesign.currentVersionId).not.toBe(
    data.design.currentVersionId,
  );
  expect(importedDesign.versions[0]!.code).toContain(
    `/api/media/${importedMedia.id}`,
  );
  expect(target.store.get<Design>("designs", data.design.id)?.name).toBe(
    "Local design",
  );
  expect(
    target.store.get<Inspiration>("references", data.reference.id)?.title,
  ).toBe("Local reference");
});

test("missing images and traversal paths fail before importing any records", async () => {
  const source = fixture();
  const { media } = await seed(source.store);
  const bytes = new Uint8Array(
    await (await source.app.request("/backup")).arrayBuffer(),
  );
  const files = unzipSync(bytes);
  delete files[`media/${media.id}`];
  const target = fixture();
  const missing = await importBackup(target.app, zipSync(files));
  expect(missing.status).toBe(400);
  const traversal = await importBackup(
    target.app,
    zipSync({ ...files, "../escape": new Uint8Array([1]) }),
  );
  expect(traversal.status).toBe(400);
  expect(target.store.list("references")).toEqual([]);
  expect(target.store.list("designs")).toEqual([]);
  expect(target.store.listMedia()).toEqual([]);
});

test("restore transaction failure rolls back documents, media metadata and disk blobs", async () => {
  const source = fixture();
  await seed(source.store);
  const backup = new Uint8Array(
    await (await source.app.request("/backup")).arrayBuffer(),
  );
  const target = fixture();
  const originalPut = target.store.put.bind(target.store);
  target.store.put = (collection, value) => {
    if (collection === "designs") throw new Error("Injected database failure");
    return originalPut(collection, value);
  };
  const response = await importBackup(target.app, backup);
  expect(response.status).toBe(500);
  expect(target.store.list("references")).toEqual([]);
  expect(target.store.list("designs")).toEqual([]);
  expect(target.store.listMedia()).toEqual([]);
  expect(readdirSync(join(target.directory, "media"))).toEqual([]);
});

test("deleted references in historical recipes remain portable", async () => {
  const source = fixture();
  const { reference, design } = await seed(source.store);
  source.store.remove("references", reference.id);
  const backup = new Uint8Array(
    await (await source.app.request("/backup")).arrayBuffer(),
  );
  const target = fixture();
  const response = await importBackup(target.app, backup);
  expect(response.status).toBe(200);
  expect(target.store.get<Design>("designs", design.id)?.versions).toEqual(
    design.versions,
  );
  expect(target.store.listMedia()).toHaveLength(1);
});

test("deflate entries cannot expand past a forged declared size", async () => {
  const target = fixture();
  const bytes = zipSync(
    { "manifest.json": new TextEncoder().encode("x".repeat(100000)) },
    { level: 9 },
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 16, true);
      break;
    }
  }
  const response = await importBackup(target.app, bytes);
  expect(response.status).toBe(413);
  expect(target.store.listMedia()).toEqual([]);
  expect(target.store.list("designs")).toEqual([]);
});
