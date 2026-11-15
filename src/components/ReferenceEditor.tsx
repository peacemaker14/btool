import { useEffect, useMemo, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Crop as CropIcon, ImagePlus, Trash2, Upload, X } from "lucide-react";
import type {
  Crop,
  Inspiration,
  MediaFile,
  Screenshot,
} from "../../shared/types";
import { COMPONENT_TYPES, PAGE_TYPES } from "../../shared/types";
import { api, json, mediaUrl, message, uploadMedia } from "../lib/api";
import {
  Badge,
  Button,
  Dialog,
  ErrorMessage,
  Field,
  Input,
  Textarea,
} from "./ui";
const split = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
export function ReferenceEditor({
  open,
  onOpenChange,
  existing,
  media,
  savedPageTypes,
  savedComponentTypes,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  existing?: Inspiration;
  media: MediaFile[];
  savedPageTypes: string[];
  savedComponentTypes: string[];
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [pageType, setPageType] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [uploaded, setUploaded] = useState<MediaFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [cropId, setCropId] = useState<string | null>(null);
  const pageTypeOptions = useMemo(
    () => [...new Set([...PAGE_TYPES, ...savedPageTypes])],
    [savedPageTypes],
  );
  const componentTypeOptions = useMemo(
    () => [...new Set([...COMPONENT_TYPES, ...savedComponentTypes])],
    [savedComponentTypes],
  );
  useEffect(() => {
    if (open) {
      setTitle(existing?.title || "");
      setUrl(existing?.url || "");
      setNotes(existing?.notes || "");
      setPageType(existing?.pageType || "");
      setTypes(existing?.componentTypes || []);
      setTags(existing?.tags.join(", ") || "");
      setScreenshots(structuredClone(existing?.screenshots || []));
      setUploaded([]);
      setError("");
    }
  }, [open, existing]);
  const files = [...media, ...uploaded];
  async function addFiles(values: File[]) {
    if (!values.length) return;
    setUploading(true);
    setError("");
    try {
      const added = await uploadMedia(values);
      setUploaded((prev) => [...prev, ...added]);
      setScreenshots((prev) => [
        ...prev,
        ...added.map((file) => ({
          id: crypto.randomUUID(),
          mediaId: file.id,
          caption: file.name,
        })),
      ]);
    } catch (err) {
      setError(message(err));
    } finally {
      setUploading(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!screenshots.length) {
      setError("Add at least one screenshot.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(existing ? "/references/" + existing.id : "/references", {
        method: existing ? "PUT" : "POST",
        body: json({
          title,
          url,
          notes,
          pageType,
          componentTypes: types,
          tags: split(tags),
          screenshots,
        }),
      });
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const cropShot = screenshots.find((s) => s.id === cropId);
  const cropMedia = files.find((file) => file.id === cropShot?.mediaId);
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => !busy && !uploading && onOpenChange(value)}
        title={existing ? "Edit inspiration" : "Save an inspiration"}
        description="Keep the screenshot, its source, and what caught your eye."
        wide
      >
        <form
          className="reference-form"
          onSubmit={save}
          onPaste={(event) => {
            const images = [...event.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (images.length) {
              event.preventDefault();
              void addFiles(images);
            }
          }}
        >
          <div className="reference-fields">
            <Field label="Title (required)">
              <Input
                name="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                maxLength={200}
              />
            </Field>
            <Field label="Source URL">
              <Input
                name="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </Field>
            <Field label="What is worth keeping?">
              <Textarea
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="The generous spacing, the horizontal tabs, the type hierarchy…"
                rows={4}
              />
            </Field>
            <Field label="Page type">
              <Input
                name="pageType"
                list="page-types"
                value={pageType}
                onChange={(e) => setPageType(e.target.value)}
                placeholder="Choose or write a page type"
              />
              <datalist id="page-types">
                {pageTypeOptions.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </Field>
            <fieldset className="field">
              <legend>Component types</legend>
              <div className="chip-options">
                {componentTypeOptions.map((type) => (
                  <button
                    className={
                      "chip-option " + (types.includes(type) ? "selected" : "")
                    }
                    type="button"
                    key={type}
                    aria-pressed={types.includes(type)}
                    onClick={() =>
                      setTypes((prev) =>
                        prev.includes(type)
                          ? prev.filter((t) => t !== type)
                          : [...prev, type],
                      )
                    }
                  >
                    {type}
                  </button>
                ))}
              </div>
              <Input
                name="componentTypes"
                aria-label="Custom component types, comma separated"
                value={types.join(", ")}
                onChange={(e) =>
                  setTypes(e.target.value.split(",").map((s) => s.trimStart()))
                }
                onBlur={() => setTypes((prev) => split(prev.join(",")))}
                placeholder="Add custom types, separated by commas"
              />
            </fieldset>
            <Field label="Tags" hint="Separate tags with commas.">
              <Input
                name="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Minimal, editorial, dark"
              />
            </Field>
          </div>
          <div className="reference-images">
            <label
              className={"upload-zone " + (uploading ? "is-loading" : "")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!uploading) void addFiles([...e.dataTransfer.files]);
              }}
            >
              <Upload size={24} aria-hidden="true" />
              <strong>
                {uploading ? "Importing screenshots…" : "Drop screenshots here"}
              </strong>
              <span>Choose files or paste an image</span>
              <span className="hint">PNG, JPEG or WebP, up to 20 MB each</span>
              <input
                type="file"
                name="screenshots"
                accept="image/png,image/jpeg,image/webp"
                multiple
                disabled={uploading}
                onChange={(e) => {
                  void addFiles([...(e.target.files || [])]);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="screenshot-list">
              {screenshots.map((shot) => {
                const file = files.find((f) => f.id === shot.mediaId);
                return (
                  <div className="screenshot-item" key={shot.id}>
                    <img
                      src={mediaUrl(shot.mediaId)}
                      alt={shot.caption || "Imported screenshot"}
                      width={file?.width || 800}
                      height={file?.height || 600}
                    />
                    <div className="screenshot-caption">
                      <Input
                        aria-label="Screenshot caption"
                        value={shot.caption}
                        onChange={(e) =>
                          setScreenshots((prev) =>
                            prev.map((s) =>
                              s.id === shot.id
                                ? { ...s, caption: e.target.value }
                                : s,
                            ),
                          )
                        }
                      />
                      {shot.crop && <Badge>Cropped for generation</Badge>}
                      <div className="actions">
                        <Button
                          variant="secondary"
                          onClick={() => setCropId(shot.id)}
                        >
                          <CropIcon size={15} aria-hidden="true" />
                          Crop
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove screenshot"
                          onClick={() =>
                            setScreenshots((prev) =>
                              prev.filter((s) => s.id !== shot.id),
                            )
                          }
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!screenshots.length && (
              <p className="hint image-hint">
                <ImagePlus size={16} aria-hidden="true" />
                One source can hold desktop, mobile, and detail screenshots.
              </p>
            )}
          </div>
          <footer className="form-footer">
            <ErrorMessage>{error}</ErrorMessage>
            <Button type="submit" disabled={busy || uploading}>
              {busy ? "Saving…" : "Save inspiration"}
            </Button>
          </footer>
        </form>
      </Dialog>
      {cropShot && cropMedia && (
        <CropDialog
          image={cropMedia}
          initial={cropShot.crop}
          onClose={() => setCropId(null)}
          onSave={(crop) => {
            setScreenshots((prev) =>
              prev.map((s) => (s.id === cropId ? { ...s, crop } : s)),
            );
            setCropId(null);
          }}
        />
      )}
    </>
  );
}
function CropDialog({
  image,
  initial,
  onClose,
  onSave,
}: {
  image: MediaFile;
  initial?: Crop;
  onClose: () => void;
  onSave: (crop?: Crop) => void;
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(image.width / image.height);
  const [area, setArea] = useState<Area | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(value) => !value && onClose()}
      title="Choose the useful detail"
      description="The original stays untouched. This crop is used only when selected in a recipe."
    >
      <div className="crop-stage">
        <Cropper
          image={mediaUrl(image.id)}
          crop={position}
          zoom={zoom}
          aspect={aspect}
          onCropChange={setPosition}
          onZoomChange={setZoom}
          onCropComplete={setArea}
          initialCroppedAreaPercentages={
            initial
              ? {
                  x: initial.x * 100,
                  y: initial.y * 100,
                  width: initial.width * 100,
                  height: initial.height * 100,
                }
              : undefined
          }
        />
      </div>
      <div className="crop-controls">
        <Field label="Aspect ratio">
          <select
            name="aspect"
            className="input"
            value={aspect}
            onChange={(e) => setAspect(Number(e.target.value))}
          >
            <option value={image.width / image.height}>Original</option>
            <option value={1}>Square</option>
            <option value={16 / 9}>Landscape</option>
            <option value={4 / 3}>4:3</option>
            <option value={3 / 4}>Portrait</option>
          </select>
        </Field>
        <Field label="Zoom">
          <input
            type="range"
            name="zoom"
            min={1}
            max={5}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </Field>
      </div>
      <footer className="form-footer">
        <Button variant="ghost" onClick={() => onSave(undefined)}>
          <X size={15} aria-hidden="true" />
          Remove crop
        </Button>
        <Button
          onClick={() =>
            area &&
            onSave({
              x: area.x / 100,
              y: area.y / 100,
              width: area.width / 100,
              height: area.height / 100,
            })
          }
        >
          Use crop
        </Button>
      </footer>
    </Dialog>
  );
}
