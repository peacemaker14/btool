import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Code2,
  Download,
  History,
  ImagePlus,
  Layers2,
  Maximize2,
  Monitor,
  Palette,
  Play,
  Plus,
  Save,
  Smartphone,
  Square,
  Trash2,
  Type,
  X,
} from "lucide-react";
import type {
  ComponentConfig,
  Design,
  GenerationJob,
  Inspiration,
  LibraryState,
  MediaFile,
  PreviewArtifact,
  Recipe,
  ReferenceRole,
} from "../../shared/types";
import { COMPONENT_TYPES, REFERENCE_ROLES } from "../../shared/types";
import {
  api,
  formatDate,
  json,
  mediaUrl,
  message,
  uploadMedia,
} from "../lib/api";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Textarea,
} from "./ui";
interface Props {
  design: Design;
  library: LibraryState;
  onUpdated: (design: Design) => void;
  reload: () => Promise<void>;
  onBack: () => void;
  onSettings: () => void;
}
export function Workspace({
  design,
  library,
  onUpdated,
  reload,
  onBack,
  onSettings,
}: Props) {
  const [recipe, setRecipe] = useState<Recipe>(() =>
    structuredClone(design.recipe),
  );
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<PreviewArtifact | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [saved, setSaved] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const alive = useRef(true);
  const jobRef = useRef<GenerationJob | null>(null);
  const version = design.versions.find((v) => v.id === design.currentVersionId);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setRecipe(structuredClone(design.recipe));
    setSaved(true);
    setError("");
    setRuntimeError("");
    setJob(null);
    setPreview(null);
    setCode(version?.code || "");
    if (version) {
      void api<PreviewArtifact>("/preview", {
        method: "POST",
        body: json({ code: version.code, recipe: design.recipe }),
      })
        .then((value) => {
          if (alive.current) setPreview(value);
        })
        .catch((err) => {
          if (alive.current) setError(message(err));
        });
    }
  }, [design.id]);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "btools:preview-error")
        setRuntimeError(
          String(
            event.data.error ||
              event.data.message ||
              "Component runtime error.",
          ),
        );
      if (event.data?.type === "btools:ready")
        frame.current?.contentWindow?.postMessage(
          { type: "btools:config", config: recipe.config },
          "*",
        );
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [recipe.config]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "btools:config", config: recipe.config },
      "*",
    );
  }, [recipe.config, preview]);
  function change(next: Recipe) {
    setRecipe(next);
    setSaved(false);
  }
  function config(next: Partial<ComponentConfig>) {
    change({ ...recipe, config: { ...recipe.config, ...next } });
  }
  async function saveRecipe() {
    setBusy("saving");
    setError("");
    try {
      const updated = await api<Design>("/designs/" + design.id, {
        method: "PUT",
        body: json({ name: recipe.name, recipe }),
      });
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function apply() {
    setBusy("compiling");
    setError("");
    try {
      const result = await api<{ design: Design; preview: PreviewArtifact }>(
        "/designs/" + design.id + "/apply",
        { method: "POST", body: json({ code, recipe, label: "Code edit" }) },
      );
      onUpdated(result.design);
      setPreview(result.preview);
      setRuntimeError("");
      setSaved(true);
      setTab("preview");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function generate() {
    if (!library.settings.consent) {
      setError(
        "Enable selected-input transmission in Settings before generating.",
      );
      return;
    }
    if (!recipe.references.length) {
      setPicker(true);
      setError("Select at least one reference and assign its role.");
      return;
    }
    setBusy("generating");
    setError("");
    try {
      const started = await api<GenerationJob>(
        "/designs/" + design.id + "/generate",
        {
          method: "POST",
          body: json({ recipe, model: library.settings.model }),
        },
      );
      jobRef.current = started;
      setJob(started);
      for (;;) {
        const pause = Promise.withResolvers<void>();
        setTimeout(pause.resolve, 900);
        await pause.promise;
        const next = await api<GenerationJob>("/jobs/" + started.id);
        jobRef.current = next;
        if (alive.current) setJob(next);
        if (next.status === "succeeded") {
          if (alive.current && next.design && next.preview) {
            onUpdated(next.design);
            setRecipe(structuredClone(next.design.recipe));
            setCode(
              next.design.versions.find(
                (v) => v.id === next.design!.currentVersionId,
              )?.code || "",
            );
            setPreview(next.preview);
            setRuntimeError("");
            setSaved(true);
            setTab("preview");
          } else await reload();
          break;
        }
        if (next.status === "failed" || next.status === "cancelled")
          throw new Error(
            next.error ||
              (next.status === "cancelled"
                ? "Generation cancelled. Last working version preserved."
                : "Generation failed."),
          );
      }
    } catch (err) {
      if (alive.current) setError(message(err));
    } finally {
      if (alive.current) setBusy("");
    }
  }
  async function cancel() {
    if (!jobRef.current) return;
    try {
      const next = await api<GenerationJob>(
        "/jobs/" + jobRef.current.id + "/cancel",
        { method: "POST" },
      );
      setJob(next);
    } catch (err) {
      setError(message(err));
    }
  }
  async function restoreVersion(id: string) {
    setBusy("restoring");
    setError("");
    try {
      const updated = await api<Design>("/designs/" + design.id, {
        method: "PUT",
        body: json({ currentVersionId: id }),
      });
      const selected = updated.versions.find((v) => v.id === id)!;
      const artifact = await api<PreviewArtifact>("/preview", {
        method: "POST",
        body: json({ code: selected.code, recipe: updated.recipe }),
      });
      onUpdated(updated);
      setRecipe(structuredClone(updated.recipe));
      setCode(selected.code);
      setPreview(artifact);
      setRuntimeError("");
      setSaved(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function exportCode(format: "project" | "source") {
    setBusy("exporting");
    setError("");
    try {
      if (!saved) {
        const updated = await api<Design>("/designs/" + design.id, {
          method: "PUT",
          body: json({ name: recipe.name, recipe }),
        });
        onUpdated(updated);
        setSaved(true);
      }
      const response = await fetch(
        "/api/designs/" + design.id + "/export?format=" + format,
      );
      if (!response.ok) {
        const value = await response.json();
        throw new Error(value.error || "Export failed.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        recipe.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase() +
        "-" +
        format +
        ".zip";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function addAssets(files: File[]) {
    setBusy("assets");
    setError("");
    try {
      const uploaded = await uploadMedia(files);
      change({
        ...recipe,
        assetIds: [...recipe.assetIds, ...uploaded.map((file) => file.id)],
      });
      await reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div className="workspace-name">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back to designs"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </Button>
          <Input
            aria-label="Design name"
            name="designName"
            className="name-input"
            value={recipe.name}
            onChange={(e) => change({ ...recipe, name: e.target.value })}
          />
          <span className="save-state">
            {saved ? "Saved locally" : "Unsaved recipe"}
          </span>
        </div>
        <div className="actions">
          <Button
            variant="secondary"
            onClick={() => void saveRecipe()}
            disabled={!!busy}
          >
            <Save size={15} aria-hidden="true" />
            Save recipe
          </Button>
          <Button
            onClick={() => void generate()}
            disabled={!!busy}
            aria-busy={busy === "generating"}
          >
            <Play size={15} aria-hidden="true" />
            {busy === "generating"
              ? "Generating…"
              : version
                ? "Generate version"
                : "Generate component"}
          </Button>
        </div>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {job && busy === "generating" && (
        <div className="generation-status" role="status">
          <span>{job.stage || "Preparing generation…"}</span>
          <Button variant="ghost" onClick={() => void cancel()}>
            <Square size={12} aria-hidden="true" />
            Cancel
          </Button>
        </div>
      )}
      <div className="workspace-grid">
        <aside className="recipe-panel">
          <section>
            <div className="section-heading">
              <h2>Reference recipe</h2>
              <Badge>{recipe.references.length}</Badge>
            </div>
            <p className="hint">Choose what to borrow, not what to copy.</p>
            <Field label="Component type">
              <select
                name="componentType"
                className="input"
                value={recipe.componentType}
                onChange={(e) =>
                  change({ ...recipe, componentType: e.target.value })
                }
              >
                {COMPONENT_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </Field>
            <div className="recipe-sources">
              {recipe.references.map((selection, index) => {
                const reference = library.references.find(
                  (r) => r.id === selection.referenceId,
                );
                const screenshot = reference?.screenshots.find(
                  (s) => s.id === selection.screenshotId,
                );
                return (
                  <div
                    className="recipe-source"
                    key={
                      selection.referenceId +
                      selection.screenshotId +
                      selection.role +
                      index
                    }
                  >
                    {screenshot && (
                      <img
                        src={mediaUrl(screenshot.mediaId)}
                        alt=""
                        width={88}
                        height={64}
                      />
                    )}
                    <div>
                      <strong>{reference?.title || "Deleted reference"}</strong>
                      <select
                        className="input compact-input"
                        aria-label="Reference role"
                        value={selection.role}
                        onChange={(e) =>
                          change({
                            ...recipe,
                            references: recipe.references.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    role: e.target.value as ReferenceRole,
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        {REFERENCE_ROLES.map((role) => (
                          <option key={role}>{role}</option>
                        ))}
                      </select>
                      {screenshot?.crop && (
                        <label className="check-label">
                          <input
                            type="checkbox"
                            name="useCrop"
                            checked={selection.useCrop}
                            onChange={(e) =>
                              change({
                                ...recipe,
                                references: recipe.references.map((item, i) =>
                                  i === index
                                    ? { ...item, useCrop: e.target.checked }
                                    : item,
                                ),
                              })
                            }
                          />
                          Use crop
                        </label>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove reference from recipe"
                      onClick={() =>
                        change({
                          ...recipe,
                          references: recipe.references.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button
              variant="secondary"
              className="full-width"
              onClick={() => setPicker(true)}
            >
              <Plus size={15} aria-hidden="true" />
              Choose references
            </Button>
          </section>
          <section>
            <Field label="Remix instructions">
              <Textarea
                name="instructions"
                value={recipe.instructions}
                onChange={(e) =>
                  change({ ...recipe, instructions: e.target.value })
                }
                placeholder="Use the first reference’s composition and the second’s quiet typography."
                rows={5}
              />
            </Field>
            <p className="hint">
              Only selected screenshots, notes, and this recipe reach your
              configured model.
            </p>
          </section>
          <section>
            <div className="section-heading">
              <h2>Your output assets</h2>
              <label className="icon-upload" aria-label="Upload output images">
                <ImagePlus size={17} aria-hidden="true" />
                <input
                  name="assets"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={!!busy}
                  onChange={(e) => {
                    void addAssets([...(e.target.files || [])]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="hint">
              Explicitly supplied imagery, never lifted from references.
            </p>
            <div className="asset-list">
              {recipe.assetIds.map((id) => {
                const media = library.media.find((file) => file.id === id);
                return (
                  <div className="asset-row" key={id}>
                    <img src={mediaUrl(id)} width={40} height={40} alt="" />
                    <span>{media?.name || "Image"}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove output asset"
                      onClick={() =>
                        change({
                          ...recipe,
                          assetIds: recipe.assetIds.filter(
                            (value) => value !== id,
                          ),
                        })
                      }
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
          <details className="history-section">
            <summary>
              <History size={16} aria-hidden="true" />
              Version history <Badge>{design.versions.length}</Badge>
            </summary>
            {!design.versions.length && (
              <p className="hint">
                Successful generations and code edits appear here.
              </p>
            )}
            {[...design.versions].reverse().map((item, i) => (
              <button
                type="button"
                className={
                  "version-item " +
                  (item.id === design.currentVersionId ? "selected" : "")
                }
                key={item.id}
                disabled={!!busy}
                onClick={() => void restoreVersion(item.id)}
              >
                <span>
                  {item.label || "Version " + (design.versions.length - i)}
                </span>
                <time>{formatDate(item.createdAt)}</time>
                {item.id === design.currentVersionId && (
                  <Check size={14} aria-hidden="true" />
                )}
              </button>
            ))}
          </details>
        </aside>
        <section className="preview-panel" aria-label="Component workspace">
          <div className="preview-toolbar">
            <div
              className="tab-list"
              role="tablist"
              aria-label="Workspace view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "preview"}
                onClick={() => setTab("preview")}
              >
                <Layers2 size={15} aria-hidden="true" />
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "code"}
                onClick={() => setTab("code")}
              >
                <Code2 size={15} aria-hidden="true" />
                Code
              </button>
            </div>
            <div className="actions">
              {tab === "preview" ? (
                <div className="device-buttons">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Desktop preview"
                    aria-pressed={device === "desktop"}
                    onClick={() => setDevice("desktop")}
                  >
                    <Monitor size={16} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Mobile preview"
                    aria-pressed={device === "mobile"}
                    onClick={() => setDevice("mobile")}
                  >
                    <Smartphone size={16} aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => void apply()}
                  disabled={!code.trim() || !!busy}
                >
                  {busy === "compiling" ? "Compiling…" : "Apply code"}
                </Button>
              )}
            </div>
          </div>
          {tab === "preview" ? (
            <div className={"preview-canvas " + device}>
              {preview ? (
                <iframe
                  ref={frame}
                  title="Generated component preview"
                  src={preview.url}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  onLoad={() =>
                    frame.current?.contentWindow?.postMessage(
                      { type: "btools:config", config: recipe.config },
                      "*",
                    )
                  }
                />
              ) : (
                <EmptyState
                  icon={<Layers2 size={38} />}
                  title="Your references, a new component"
                >
                  Assign inspiration roles, adjust the recipe, then generate a
                  working React component.
                </EmptyState>
              )}
            </div>
          ) : (
            <div className="code-panel">
              <label className="code-label" htmlFor="component-source">
                Component.tsx
              </label>
              <textarea
                id="component-source"
                name="componentSource"
                className="code-editor"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-label="Component source code"
                placeholder="Generated source appears here. You can also paste a React component using the configuration contract."
              />
              <p className="hint">
                Default export: <code>{"Component({ config })"}</code>. React
                imports only. Apply compiles first and keeps the last working
                version on errors.
              </p>
            </div>
          )}
          <ErrorMessage>
            {runtimeError && "Preview runtime error: " + runtimeError}
          </ErrorMessage>
          <footer className="preview-footer">
            <span>{device === "mobile" ? "390 px" : "Responsive"} preview</span>
            <div className="actions">
              <Button
                variant="ghost"
                disabled={!version || !!busy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                  } catch {
                    setError(
                      "Clipboard unavailable. Select and copy the code from the Code tab.",
                    );
                  }
                }}
              >
                Copy source
              </Button>
              <details className="export-menu">
                <summary
                  className={
                    "btn btn-secondary " + (!version || busy ? "disabled" : "")
                  }
                >
                  <Download size={15} aria-hidden="true" />
                  Export
                </summary>
                {version && !busy && (
                  <div className="export-options">
                    <button
                      type="button"
                      onClick={() => void exportCode("project")}
                    >
                      Runnable project ZIP
                    </button>
                    <button
                      type="button"
                      onClick={() => void exportCode("source")}
                    >
                      Source and assets ZIP
                    </button>
                  </div>
                )}
              </details>
            </div>
          </footer>
        </section>
        <aside className="inspector">
          <section>
            <h2>
              <Type size={16} aria-hidden="true" />
              Content
            </h2>
            {Object.entries(recipe.config.content).map(([key, value]) => (
              <Field
                key={key}
                label={key.replace(/([A-Z])/g, " $1").toLowerCase()}
              >
                <Textarea
                  name={"content-" + key}
                  rows={value.length > 80 ? 3 : 1}
                  value={value}
                  onChange={(e) =>
                    config({
                      content: {
                        ...recipe.config.content,
                        [key]: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            ))}
            <AddContent
              onAdd={(key) =>
                config({ content: { ...recipe.config.content, [key]: "" } })
              }
            />
          </section>
          <section>
            <h2>
              <Palette size={16} aria-hidden="true" />
              Design tokens
            </h2>
            <div className="color-fields">
              {Object.entries(recipe.config.colors).map(([key, value]) => (
                <label key={key} className="color-field">
                  <span>{key}</span>
                  <input
                    name={"color-" + key}
                    aria-label={key + " color"}
                    type="color"
                    value={value}
                    onChange={(e) =>
                      config({
                        colors: {
                          ...recipe.config.colors,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                  <Input
                    aria-label={key + " hex value"}
                    name={"hex-" + key}
                    value={value}
                    pattern="#[0-9a-fA-F]{6}"
                    onChange={(e) =>
                      config({
                        colors: {
                          ...recipe.config.colors,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <Field label="Font">
              <select
                className="input"
                name="fontFamily"
                value={recipe.config.fontFamily}
                onChange={(e) => config({ fontFamily: e.target.value })}
              >
                <option value="system-ui">System sans</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="ui-monospace, monospace">Monospace</option>
              </select>
            </Field>
            {(
              [
                { key: "fontSize", label: "Type size", min: 12, max: 32 },
                { key: "spacing", label: "Spacing", min: 4, max: 80 },
                { key: "radius", label: "Corner radius", min: 0, max: 40 },
              ] as const
            ).map((control) => (
              <Field
                key={control.key}
                label={
                  control.label + ": " + recipe.config[control.key] + " px"
                }
              >
                <input
                  type="range"
                  name={control.key}
                  min={control.min}
                  max={control.max}
                  step={1}
                  value={recipe.config[control.key]}
                  onChange={(e) =>
                    config({ [control.key]: Number(e.target.value) })
                  }
                />
              </Field>
            ))}
          </section>
          <p className="hint">
            Content and tokens update instantly. Structural changes require
            generation. Manual code must keep honoring this contract.
          </p>
          <button
            className="text-button model-label"
            type="button"
            onClick={onSettings}
          >
            {library.settings.model}
          </button>
        </aside>
      </div>
      <ReferencePicker
        open={picker}
        onClose={() => setPicker(false)}
        references={library.references}
        selected={recipe.references}
        onChoose={(selection) =>
          change({ ...recipe, references: [...recipe.references, selection] })
        }
      />
    </div>
  );
}
function AddContent({ onAdd }: { onAdd: (key: string) => void }) {
  const [key, setKey] = useState("");
  return (
    <div className="add-content">
      <Input
        name="newContentKey"
        aria-label="New content field name"
        value={key}
        onChange={(e) => setKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
        placeholder="New field name"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Add content field"
        onClick={() => {
          if (key && !["__proto__", "constructor", "prototype"].includes(key)) {
            onAdd(key);
            setKey("");
          }
        }}
      >
        <Plus size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
function ReferencePicker({
  open,
  onClose,
  references,
  selected,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  references: Inspiration[];
  selected: Recipe["references"];
  onChoose: (selection: Recipe["references"][number]) => void;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<ReferenceRole>("layout");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title="Build a reference recipe"
      description="Choose an image and name the trait it should contribute."
      wide
    >
      <div className="picker-toolbar">
        <Input
          name="referenceSearch"
          aria-label="Search saved references"
          placeholder="Search your library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          name="newReferenceRole"
          className="input"
          aria-label="Role to borrow"
          value={role}
          onChange={(e) => setRole(e.target.value as ReferenceRole)}
        >
          {REFERENCE_ROLES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="picker-grid">
        {references
          .filter((reference) =>
            (
              reference.title +
              " " +
              reference.notes +
              " " +
              reference.tags.join(" ")
            )
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .flatMap((reference) =>
            reference.screenshots.map((screenshot) => {
              const exists = selected.some(
                (s) =>
                  s.referenceId === reference.id &&
                  s.screenshotId === screenshot.id &&
                  s.role === role,
              );
              return (
                <button
                  type="button"
                  className={"picker-item " + (exists ? "selected" : "")}
                  key={reference.id + screenshot.id}
                  disabled={exists}
                  onClick={() =>
                    onChoose({
                      referenceId: reference.id,
                      screenshotId: screenshot.id,
                      role,
                      useCrop: !!screenshot.crop,
                    })
                  }
                >
                  <img
                    src={mediaUrl(screenshot.mediaId)}
                    alt={screenshot.caption || reference.title}
                    width={400}
                    height={260}
                  />
                  <span>
                    <strong>{reference.title}</strong>
                    <small>
                      {exists ? "Added as " + role : "Borrow " + role}
                      {screenshot.crop ? " (crop available)" : ""}
                    </small>
                  </span>
                  {exists && <Check size={18} aria-hidden="true" />}
                </button>
              );
            }),
          )}
      </div>
      {!references.length && (
        <p className="hint">Save an inspiration in the library first.</p>
      )}
      <footer className="form-footer">
        <span className="hint">{selected.length} role assignments</span>
        <Button onClick={onClose}>Done</Button>
      </footer>
    </Dialog>
  );
}
