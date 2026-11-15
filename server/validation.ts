import { z } from "zod";
import type { Inspiration, MediaFile, Recipe } from "../shared/types";
import type { Store } from "./contracts";

export const idSchema = z.uuid();
const shortText = z.string().trim().max(200);
const requiredText = shortText.min(1);
const timestampSchema = z.iso.datetime();
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const cropSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
  .refine(
    (crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1,
    "Crop must stay inside the image",
  );

const screenshotFields = {
  mediaId: idSchema,
  caption: z.string().max(2000).default(""),
  crop: cropSchema.optional(),
};
export const screenshotSchema = z
  .object({ id: idSchema, ...screenshotFields })
  .strict();
const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Source URL must be http or https");
const inspirationFields = {
  title: requiredText,
  url: urlSchema.default(""),
  notes: z.string().max(50000).default(""),
  pageType: shortText.default(""),
  componentTypes: z.array(shortText.min(1)).max(50).default([]),
  tags: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
};
export const inspirationInputSchema = z
  .object({
    ...inspirationFields,
    screenshots: z
      .array(
        z.object({ id: idSchema.optional(), ...screenshotFields }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (value) =>
      unique(value.screenshots.flatMap((item) => (item.id ? [item.id] : []))),
    "Screenshot IDs must be unique",
  );
export const inspirationSchema: z.ZodType<Inspiration> = z
  .object({
    id: idSchema,
    ...inspirationFields,
    screenshots: z.array(screenshotSchema).min(1).max(100),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .refine(
    (value) => unique(value.screenshots.map((item) => item.id)),
    "Screenshot IDs must be unique",
  );

const assetSchema = z
  .object({
    id: idSchema,
    name: z.string().max(255),
    src: z.string().max(100),
  })
  .strict()
  .refine(
    (value) => value.src === `/api/media/${value.id}`,
    "Assets must use their uploaded media URL",
  );
export const recipeSchema: z.ZodType<Recipe> = z
  .object({
    name: requiredText,
    componentType: requiredText,
    references: z
      .array(
        z
          .object({
            referenceId: idSchema,
            screenshotId: idSchema,
            role: z.enum(["layout", "typography", "palette", "details"]),
            useCrop: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    instructions: z.string().max(50000),
    config: z
      .object({
        content: z
          .record(z.string().max(100), z.string().max(20000))
          .refine(
            (value) => Object.keys(value).length <= 100,
            "Too many content fields",
          ),
        colors: z
          .object({
            background: z.string().min(1).max(200),
            foreground: z.string().min(1).max(200),
            primary: z.string().min(1).max(200),
            muted: z.string().min(1).max(200),
          })
          .strict(),
        fontFamily: z.string().min(1).max(200),
        fontSize: z.number().finite().min(8).max(200),
        spacing: z.number().finite().min(0).max(300),
        radius: z.number().finite().min(0).max(500),
        assets: z
          .array(assetSchema)
          .max(100)
          .refine(
            (value) => unique(value.map((asset) => asset.id)),
            "Asset IDs must be unique",
          ),
      })
      .strict(),
    assetIds: z
      .array(idSchema)
      .max(100)
      .refine(unique, "Asset IDs must be unique"),
  })
  .strict();

export const versionSchema = z
  .object({
    id: idSchema,
    createdAt: timestampSchema,
    label: z.string().max(200),
    code: z.string().max(2 * 1024 * 1024),
    recipe: recipeSchema,
  })
  .strict();
export const designSchema = z
  .object({
    id: idSchema,
    name: requiredText,
    recipe: recipeSchema,
    versions: z
      .array(versionSchema)
      .max(500)
      .refine(
        (value) => unique(value.map((version) => version.id)),
        "Version IDs must be unique",
      ),
    currentVersionId: idSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.currentVersionId === null ||
      value.versions.some((version) => version.id === value.currentVersionId),
    "Current version is missing",
  );
export const mediaSchema: z.ZodType<MediaFile> = z
  .object({
    id: idSchema,
    name: z
      .string()
      .max(255)
      .regex(
        /^[^\\/\u0000-\u001f\u007f]*$/,
        "Media name must not contain a path",
      ),
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive().max(32768),
    height: z.number().int().positive().max(32768),
    size: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: timestampSchema,
  })
  .strict();
export const settingsSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\w./:@+-]+$/),
    consent: z.boolean(),
  })
  .strict();
export const createDesignSchema = z
  .object({ name: requiredText.optional(), recipe: recipeSchema.optional() })
  .strict();
export const updateDesignSchema = createDesignSchema
  .extend({ currentVersionId: idSchema.nullable().optional() })
  .strict();

export class InputError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413 | 415 = 400,
  ) {
    super(message);
    this.name = "InputError";
  }
}
export function assertMedia(store: Store, ids: Iterable<string>): void {
  for (const id of ids)
    if (!store.getMedia(id)) throw new InputError(`Media ${id} does not exist`);
}
export function validateRecipe(store: Store, input: unknown): Recipe {
  const recipe = recipeSchema.parse(input);
  assertMedia(store, [
    ...recipe.assetIds,
    ...recipe.config.assets.map((asset) => asset.id),
  ]);
  for (const selection of recipe.references) {
    const reference = store.get<Inspiration>(
      "references",
      selection.referenceId,
    );
    const screenshot = reference?.screenshots.find(
      (item) => item.id === selection.screenshotId,
    );
    if (!screenshot)
      throw new InputError("A selected reference screenshot no longer exists");
    assertMedia(store, [screenshot.mediaId]);
  }
  return recipe;
}
