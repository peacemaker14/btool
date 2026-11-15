import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Boxes,
  Download,
  ExternalLink,
  FolderOpen,
  Grid2X2,
  ImagePlus,
  LayoutGrid,
  ListFilter,
  Loader2,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  Design,
  Inspiration,
  LibraryState,
  ModelOption,
  RestoreReport,
} from "../shared/types";
import { DEFAULT_MODEL, newRecipe } from "../shared/types";
import { api, formatDate, json, mediaUrl, message } from "./lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
} from "./components/ui";
import { ReferenceEditor } from "./components/ReferenceEditor";
import { Workspace } from "./components/Workspace";
function App() {
  const [state, setState] = useState<LibraryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [location, setLocation] = useState(
    () => new URLSearchParams(window.location.search),
  );
  const [editor, setEditor] = useState(false);
  const [editing, setEditing] = useState<Inspiration | undefined>();
  const [busy, setBusy] = useState("");
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(
    null,
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const view = location.get("view") || "library";
  const query = location.get("q") || "";
  const type = location.get("type") || "";
  const page = location.get("page") || "";
  const tag = location.get("tag") || "";
  const reload = useCallback(async () => {
    const data = await api<LibraryState>("/state");
    setState(data);
  }, []);
  useEffect(() => {
    void reload()
      .catch((err) => setError(message(err)))
      .finally(() => setLoading(false));
    const pop = () => setLocation(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [reload]);
  function navigate(values: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(window.location.search);
    Object.entries(values).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      "?" + next.toString(),
    );
    setLocation(next);
    setError("");
  }
  async function createDesign(reference?: Inspiration) {
    setBusy("new");
    setError("");
    try {
      const recipe = newRecipe();
      if (reference) {
        recipe.name = reference.title + " remix";
        recipe.references = [
          {
            referenceId: reference.id,
            screenshotId: reference.screenshots[0].id,
            role: "layout",
            useCrop: !!reference.screenshots[0].crop,
          },
        ];
        recipe.componentType = reference.componentTypes[0] || "Hero section";
      }
      const design = await api<Design>("/designs", {
        method: "POST",
        body: json({ name: recipe.name, recipe }),
      });
      await reload();
      navigate({ view: "designs", design: design.id });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function deleteReference(reference: Inspiration) {
    if (
      !window.confirm(
        "Delete “" +
          reference.title +
          "” from the library? Existing generated versions remain saved.",
      )
    )
      return;
    setBusy(reference.id);
    try {
      await api("/references/" + reference.id, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function deleteDesign(design: Design) {
    if (!window.confirm("Delete “" + design.name + "” and all its versions?"))
      return;
    setBusy(design.id);
    try {
      await api("/designs/" + design.id, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  async function restore(file?: File) {
    if (!file) return;
    setBusy("restore");
    setError("");
    setRestoreReport(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const report = await api<RestoreReport>("/restore", {
        method: "POST",
        body,
      });
      await reload();
      setRestoreReport(report);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }
  function updateDesign(design: Design) {
    setState((prev) =>
      prev
        ? {
            ...prev,
            designs: prev.designs.map((item) =>
              item.id === design.id ? design : item,
            ),
          }
        : prev,
    );
  }
  const selectedDesign = state?.designs.find(
    (design) => design.id === location.get("design"),
  );
  const references =
    state?.references.filter(
      (reference) =>
        (!type || reference.componentTypes.includes(type)) &&
        (!page || reference.pageType === page) &&
        (!tag || reference.tags.includes(tag)) &&
        [
          reference.title,
          reference.notes,
          reference.url,
          ...reference.tags,
          ...reference.componentTypes,
          reference.pageType,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  const componentTypes = [
    ...new Set(
      state?.references.flatMap((reference) => reference.componentTypes) || [],
    ),
  ].sort();
  const pageTypes = [
    ...new Set(
      state?.references
        .map((reference) => reference.pageType)
        .filter(Boolean) || [],
    ),
  ].sort();
  const tags = [
    ...new Set(state?.references.flatMap((reference) => reference.tags) || []),
  ].sort();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <a
            href="?view=library"
            className="wordmark"
            onClick={(event) => {
              event.preventDefault();
              navigate({ view: "library", design: null });
            }}
            aria-label="Btools library"
          >
            <Boxes size={24} strokeWidth={1.6} aria-hidden="true" />
            btools
            <span className="wordmark-description">Inspiration workbench</span>
          </a>
          <nav aria-label="Main navigation">
            {[
              { id: "library", text: "Library", icon: BookOpen },
              { id: "designs", text: "Designs", icon: LayoutGrid },
              { id: "settings", text: "Settings", icon: Settings2 },
            ].map((item) => (
              <a
                href={"?view=" + item.id}
                key={item.id}
                className={view === item.id ? "active" : ""}
                aria-current={view === item.id ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate({ view: item.id, design: null });
                }}
              >
                <item.icon size={16} aria-hidden="true" />
                {item.text}
              </a>
            ))}
          </nav>
          <span className="local-label">
            <Archive size={14} aria-hidden="true" />
            Local library
          </span>
        </div>
      </header>
      <main
        id="main"
        className={
          "app-main " +
          (selectedDesign && view === "designs" ? "app-main-workspace" : "")
        }
      >
        <ErrorMessage>{error}</ErrorMessage>
        {loading ? (
          <div
            className="loading-surface"
            aria-label="Loading library"
            role="status"
          >
            <div className="skeleton-line" />
            <div className="skeleton-grid">
              {[1, 2, 3].map((n) => (
                <div key={n} />
              ))}
            </div>
            <span>Opening your local library…</span>
          </div>
        ) : !state ? (
          <EmptyState
            icon={<Archive size={36} />}
            title="Cannot open the library"
          >
            {error || "Check that the local server is running."}
            <Button
              onClick={() => {
                setLoading(true);
                void reload()
                  .catch((err) => setError(message(err)))
                  .finally(() => setLoading(false));
              }}
            >
              Try again
            </Button>
          </EmptyState>
        ) : view === "settings" ? (
          <Settings
            state={state}
            onSaved={reload}
            busy={busy}
            onRestore={restore}
            report={restoreReport}
          />
        ) : selectedDesign && view === "designs" ? (
          <Workspace
            key={selectedDesign.id}
            design={selectedDesign}
            library={state}
            onUpdated={updateDesign}
            reload={reload}
            onBack={() => navigate({ design: null })}
            onSettings={() => navigate({ view: "settings", design: null })}
          />
        ) : view === "designs" ? (
          <>
            <div className="page-heading">
              <div>
                <h1>Your design workbench</h1>
                <p>
                  Saved recipes, working components, and every successful
                  iteration.
                </p>
              </div>
              <Button onClick={() => void createDesign()} disabled={!!busy}>
                <Plus size={17} aria-hidden="true" />
                New component
              </Button>
            </div>
            {state.designs.length ? (
              <div className="design-table">
                <div className="design-table-head">
                  <span>Component</span>
                  <span>References</span>
                  <span>Versions</span>
                  <span>Updated</span>
                  <span />
                </div>
                {[...state.designs]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((design) => (
                    <div className="design-table-row" key={design.id}>
                      <button
                        className="design-link"
                        type="button"
                        onClick={() =>
                          navigate({ view: "designs", design: design.id })
                        }
                      >
                        <span className="design-icon">
                          <LayoutGrid size={20} aria-hidden="true" />
                        </span>
                        <span>
                          <strong>{design.name}</strong>
                          <small>{design.recipe.componentType}</small>
                        </span>
                        <ArrowUpRight size={17} aria-hidden="true" />
                      </button>
                      <span>{design.recipe.references.length}</span>
                      <span>{design.versions.length}</span>
                      <time dateTime={design.updatedAt}>
                        {formatDate(design.updatedAt)}
                      </time>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={"Delete design " + design.name}
                        disabled={!!busy}
                        onClick={() => void deleteDesign(design)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState
                icon={<LayoutGrid size={40} strokeWidth={1.3} />}
                title="Make something from what you saved"
              >
                Create a component recipe, borrow specific traits, and shape the
                result.
              </EmptyState>
            )}
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>Keep what catches your eye.</h1>
                <p>
                  A visual shelf for the details behind your next component.
                </p>
              </div>
              <Button
                onClick={() => {
                  setEditing(undefined);
                  setEditor(true);
                }}
              >
                <Plus size={17} aria-hidden="true" />
                Save inspiration
              </Button>
            </div>
            <div className="library-toolbar">
              <div className="search-field">
                <Search size={18} aria-hidden="true" />
                <Input
                  name="search"
                  aria-label="Search inspirations"
                  value={query}
                  placeholder="Search titles, notes, tags…"
                  onChange={(e) =>
                    navigate({ q: e.target.value || null }, true)
                  }
                />
                {query && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Clear search"
                    onClick={() => navigate({ q: null }, true)}
                  >
                    <X size={15} aria-hidden="true" />
                  </Button>
                )}
              </div>
              <div className="library-count">
                <Grid2X2 size={16} aria-hidden="true" />
                <span>
                  {references.length}{" "}
                  {references.length === 1 ? "inspiration" : "inspirations"}
                </span>
              </div>
              <Button
                variant="secondary"
                className="mobile-filter"
                onClick={() => setFilterOpen(!filterOpen)}
                aria-expanded={filterOpen}
              >
                <ListFilter size={16} aria-hidden="true" />
                Filters
              </Button>
            </div>
            <div className="library-layout">
              <aside
                className={"filter-rail " + (filterOpen ? "is-open" : "")}
                aria-label="Filter inspirations"
              >
                <div className="filter-group">
                  <h2>Component type</h2>
                  <button
                    type="button"
                    className={!type ? "active" : ""}
                    onClick={() => navigate({ type: null })}
                  >
                    <span>All components</span>
                    <span>{state.references.length}</span>
                  </button>
                  {componentTypes.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={type === value ? "active" : ""}
                      onClick={() =>
                        navigate({ type: type === value ? null : value })
                      }
                    >
                      <span>{value}</span>
                      <span>
                        {
                          state.references.filter((reference) =>
                            reference.componentTypes.includes(value),
                          ).length
                        }
                      </span>
                    </button>
                  ))}
                </div>
                <div className="filter-group">
                  <h2>Page type</h2>
                  {pageTypes.length ? (
                    pageTypes.map((value) => (
                      <button
                        type="button"
                        key={value}
                        className={page === value ? "active" : ""}
                        onClick={() =>
                          navigate({ page: page === value ? null : value })
                        }
                      >
                        {value}
                      </button>
                    ))
                  ) : (
                    <p className="hint">Organize as you collect.</p>
                  )}
                </div>
                {!!tags.length && (
                  <div className="filter-group">
                    <h2>Tags</h2>
                    <div className="tag-filter">
                      {tags.map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={
                            "badge " + (tag === value ? "selected" : "")
                          }
                          onClick={() =>
                            navigate({ tag: tag === value ? null : value })
                          }
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(type || page || tag) && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      navigate({ type: null, page: null, tag: null })
                    }
                  >
                    Clear filters
                  </button>
                )}
                <div className="filter-footnote">
                  <FolderOpen size={19} strokeWidth={1.4} aria-hidden="true" />
                  <p>
                    Screenshots stay here.
                    <br />
                    Ideas go somewhere new.
                  </p>
                </div>
              </aside>
              <section
                className="library-content"
                aria-label="Saved inspirations"
              >
                {references.length ? (
                  <div className="inspiration-grid">
                    {[...references]
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((reference, index) => {
                        const shot = reference.screenshots[0];
                        const media = state.media.find(
                          (file) => file.id === shot?.mediaId,
                        );
                        let source = "";
                        try {
                          source = reference.url
                            ? new URL(reference.url).hostname.replace(
                                /^www\./,
                                "",
                              )
                            : "";
                        } catch {
                          source = "";
                        }
                        return (
                          <article
                            className="inspiration-card"
                            key={reference.id}
                          >
                            <button
                              type="button"
                              className="inspiration-image"
                              aria-label={"Open " + reference.title}
                              onClick={() => {
                                setEditing(reference);
                                setEditor(true);
                              }}
                            >
                              {shot && (
                                <img
                                  src={mediaUrl(shot.mediaId)}
                                  alt={shot.caption || reference.title}
                                  width={media?.width || 800}
                                  height={media?.height || 600}
                                  loading={index === 0 ? "eager" : "lazy"}
                                  fetchPriority={index === 0 ? "high" : "auto"}
                                />
                              )}
                              {reference.screenshots.length > 1 && (
                                <span className="image-count">
                                  {reference.screenshots.length} images
                                </span>
                              )}
                            </button>
                            <div className="inspiration-caption">
                              <h2>
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={() => {
                                    setEditing(reference);
                                    setEditor(true);
                                  }}
                                >
                                  {reference.title}
                                </button>
                              </h2>
                              <div className="reference-meta">
                                {source ? (
                                  <a
                                    href={reference.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {source}
                                    <ExternalLink
                                      size={11}
                                      aria-hidden="true"
                                    />
                                  </a>
                                ) : (
                                  <span>Screenshot reference</span>
                                )}
                                <time dateTime={reference.createdAt}>
                                  {formatDate(reference.createdAt)}
                                </time>
                              </div>
                              {reference.notes && (
                                <p className="reference-note">
                                  {reference.notes}
                                </p>
                              )}
                              <div className="card-bottom">
                                <div className="card-tags">
                                  {reference.componentTypes
                                    .slice(0, 2)
                                    .map((value) => (
                                      <Badge key={value}>{value}</Badge>
                                    ))}
                                </div>
                                <div className="actions">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={
                                      "Delete inspiration " + reference.title
                                    }
                                    disabled={!!busy}
                                    onClick={() =>
                                      void deleteReference(reference)
                                    }
                                  >
                                    <Trash2 size={14} aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    aria-label={"Remix " + reference.title}
                                    disabled={!!busy}
                                    onClick={() => void createDesign(reference)}
                                  >
                                    Remix
                                    <ArrowUpRight
                                      size={15}
                                      aria-hidden="true"
                                    />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<ImagePlus size={42} strokeWidth={1.3} />}
                    title={
                      state.references.length
                        ? "Nothing matches these filters"
                        : "Start with something worth keeping"
                    }
                  >
                    {state.references.length
                      ? "Change your search or clear a filter to see more references."
                      : "Save a screenshot, its source, and the detail you want to borrow."}
                    {state.references.length ? (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          navigate({
                            q: null,
                            type: null,
                            page: null,
                            tag: null,
                          })
                        }
                      >
                        Clear search and filters
                      </Button>
                    ) : (
                      <p className="hint">
                        Use “Save inspiration” to upload or paste your first
                        image.
                      </p>
                    )}
                  </EmptyState>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      <footer className="app-footer">
        <span>Collected with intention. Built from your references.</span>
        <span>Stored on this device</span>
      </footer>
      {state && (
        <ReferenceEditor
          open={editor}
          onOpenChange={setEditor}
          existing={editing}
          media={state.media}
          savedPageTypes={pageTypes}
          savedComponentTypes={componentTypes}
          onSaved={reload}
        />
      )}
    </>
  );
}
function Settings({
  state,
  onSaved,
  busy,
  onRestore,
  report,
}: {
  state: LibraryState;
  onSaved: () => Promise<void>;
  busy: string;
  onRestore: (file?: File) => Promise<void>;
  report: RestoreReport | null;
}) {
  const [model, setModel] = useState(state.settings.model);
  const [consent, setConsent] = useState(state.settings.consent);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelError, setModelError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api<ModelOption[]>("/models")
      .then(setModels)
      .catch((err) => setModelError(message(err)));
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/settings", { method: "PUT", body: json({ model, consent }) });
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Local by default. Explicit by design.</h1>
          <p>
            Your library lives on this computer. Generation uses your configured
            OMP account.
          </p>
        </div>
      </div>
      <div className="settings-layout">
        <form className="settings-section" onSubmit={save}>
          <h2>Generation</h2>
          <Field
            label="Vision-capable OMP model"
            hint="Uses existing OMP authentication. No automatic provider or model fallback."
          >
            <select
              name="model"
              className="input"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setSaved(false);
              }}
            >
              {!models.some((item) => item.selector === model) && (
                <option value={model}>{model}</option>
              )}
              {models.map((item) => (
                <option key={item.selector} value={item.selector}>
                  {item.name} ({item.selector})
                </option>
              ))}
            </select>
          </Field>
          {modelError && (
            <p className="error-message">
              Cannot read OMP models: {modelError}
            </p>
          )}
          <label className="consent-control">
            <input
              type="checkbox"
              name="generationConsent"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                setSaved(false);
              }}
            />
            <span>
              <strong>Allow selected inputs to reach the model provider</strong>
              <span>
                On Generate, send selected screenshots or crops, their notes,
                your recipe, and supplied output assets. OMP running locally
                does not mean the model runs offline. Account usage limits and
                charges may apply.
              </span>
            </span>
          </label>
          <div className="security-note">
            <h3>Generation boundary</h3>
            <p>
              No arbitrary tools, skill scripts, or discovered MCP servers.
              Reviewed instructions guide remixing, responsive React, and
              accessibility. Generated code is compiled for an isolated browser
              preview, never executed on the server.
            </p>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div className="actions">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            {saved && (
              <span className="hint" role="status">
                Settings saved
              </span>
            )}
          </div>
        </form>
        <section className="settings-section">
          <h2>Backup and restore</h2>
          <p>
            One archive contains original images, crops, metadata, recipes, and
            version history. It does not contain account credentials.
          </p>
          <Button variant="secondary" asChild>
            <a href="/api/backup" download>
              <Download size={16} aria-hidden="true" />
              Download library backup
            </a>
          </Button>
          <div className="restore-area">
            <h3>Restore an archive</h3>
            <p>
              Imports merge into this library. Identical records are skipped;
              conflicts are kept as separate copies. Existing data and
              transmission consent stay untouched.
            </p>
            <label className="btn btn-secondary file-button">
              <Upload size={16} aria-hidden="true" />
              {busy === "restore" ? "Restoring…" : "Choose backup ZIP"}
              <input
                name="backupArchive"
                type="file"
                accept=".zip,application/zip"
                disabled={!!busy}
                onChange={(e) => {
                  void onRestore(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {report && (
              <div className="restore-report" role="status">
                <h3>Archive restored</h3>
                <dl>
                  <div>
                    <dt>References added</dt>
                    <dd>{report.references}</dd>
                  </div>
                  <div>
                    <dt>Designs added</dt>
                    <dd>{report.designs}</dd>
                  </div>
                  <div>
                    <dt>Images added</dt>
                    <dd>{report.media}</dd>
                  </div>
                  <div>
                    <dt>Duplicates skipped</dt>
                    <dd>{report.duplicates}</dd>
                  </div>
                  <div>
                    <dt>Conflicts preserved</dt>
                    <dd>{report.conflicts}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
          <div className="storage-note">
            <Archive size={19} aria-hidden="true" />
            <div>
              <strong>No cloud synchronization</strong>
              <p>Keep a backup somewhere separate from this device.</p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
export default App;
