# Btools

Personal inspiration library and React component workbench. Screenshots and metadata live on your computer; generation sends only explicitly selected inputs to your chosen model provider.

## Run

Requires Bun 1.4.4+, Node 22+, and an installed, authenticated `omp` CLI with an image-capable model.

```sh
bun install
bun run dev
```

Open **http://127.0.0.1:4316**. The local API uses port 4317; isolated component previews use port 4328. All listeners bind to loopback only.

Production:

```sh
bun run build
bun start
```

Open **http://127.0.0.1:4317**. `DATA_DIR` changes the storage directory; `PORT`, `PREVIEW_PORT`, and `DEV_PORT` change server ports (adjust the Vite development proxy when changing its API port).

### Access from another Tailscale device

On your other device, connect to the same tailnet and open the following URL, replacing the example hostname with your Mac mini's Tailscale DNS name:

`https://your-machine.your-tailnet.ts.net:8443`

Btools still binds only to loopback on the Mac mini. Tailscale Serve privately proxies HTTPS port 8443 to the app and port 10000 to the isolated preview server. Existing Serve routes on port 443 remain unchanged.

Create an ignored `.env.local` file with your own machine's two explicit public origins:

```dotenv
PUBLIC_APP_ORIGIN=https://your-machine.your-tailnet.ts.net:8443
PUBLIC_PREVIEW_ORIGIN=https://your-machine.your-tailnet.ts.net:10000
```

Keep these origins distinct. Restart `bun start` after changing them. To create the private proxies:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:4317
tailscale serve --bg --https=10000 http://127.0.0.1:4328
```

Allow both HTTPS ports in any restrictive tailnet policy. Keep the Mac mini, Btools, and Tailscale running. The MacBook uses the same server-side library; files and generation credentials remain on the Mac mini unless explicitly selected inputs are sent to the model provider.

There is no separate app login: any device permitted by your tailnet policy to access these ports can use the library and trigger generation. Use Serve, not public Funnel.

## Workflow

1. Save inspiration: upload, drop, or paste PNG/JPEG/WebP screenshots, then add a source URL, notes, page type, component types, and tags. Multiple screenshots and non-destructive crops belong to one reference. Saved page types and component categories automatically appear as reusable options alongside the defaults, without duplicates.
2. Create a design. Assign reference images to layout, typography, palette, or detail roles. Add remix instructions and explicitly owned output images.
3. In Settings, select an image-capable OMP model and consent to selected-input transmission. The default is `openai-codex/gpt-6.1-sol`. Account quotas and provider charges still apply.
4. Generate. Content and supported design tokens update the preview immediately; structural changes need another generation. Save recipe changes explicitly.
5. Use the Code tab for manual edits, then Apply. Compilation failures leave the previously accepted version intact. Runtime errors are displayed; version history lets you revert.
6. Copy source or export source/assets or a runnable React/Vite project. Export uses the accepted component source and latest saved recipe, not unapplied editor changes.

## Boundaries

- React + TypeScript + Tailwind output; frontend interactions only, not backend services or full application generation.
- Only explicitly selected screenshots/crops, their notes, recipe instructions/configuration, and supplied output assets enter generation. The rest of the library is not model context.
- Generation uses a minimal OMP model/auth SDK bridge rather than a full coding-agent session. It does not expose filesystem/shell tools, load local skills or MCP servers, or run generated server code. The installed CLI supplies image-capable model metadata; existing OMP authentication supplies provider access. There is no silent model/provider fallback.
- Reviewed generation instructions cover reference remixing, the React configuration contract, responsiveness, and accessible interactions. Relevant [Toolcraft workflow guidance](https://github.com/pixel-point/toolcraft/blob/main/starter/AGENTS.md#ai-workflow-skills-and-local-fallback) informs the build; its full canvas shell is not required.
- Preview compilation permits React imports only. Generated JavaScript runs in a separate-origin, opaque sandboxed iframe. Content Security Policy blocks fetch connections, external scripts, external images, and subframes. This is a browser permission boundary, not an operating-system sandbox for hostile code. Do not remove the iframe sandbox or combine the preview and trusted app origins.
- Manual code must retain the `Component({ config })` default-export contract and honor its content, color, font, spacing, radius, and asset fields. Source-only exports include integration instructions.
- A vision model cannot infer unseen mobile layouts or behavior from a screenshot. Notes and explicit instructions supply intent. Inspect generated accessibility and interactions before using output in a real application.

## Data and portability

The default `.data/` directory contains SQLite metadata and original raster image blobs. Uploaded files are limited to 20 MiB each; SVG/HTML uploads and automatic URL capture are not supported. Crops preserve original bytes. Deleting a reference does not delete saved generated versions.

Settings → Download library backup exports images, metadata, recipes, and versions. Restore validates the archive, skips identical records, and retains conflicting imports under new IDs with their links remapped. Existing data and transmission consent are not overwritten. Backups do not include account credentials. There is no cloud synchronization; store backups separately from this device.

## Development

```sh
bun run typecheck
bun test
bun run build
```

Frontend: React/Vite/Tailwind, with shadcn/ui-style Radix/CVA primitives adapted to the workbench theme. Backend: Bun, Hono, SQLite, Sharp, esbuild, and local Tailwind compilation. Shared domain/API types live in `shared/types.ts`.

## Verified

- Typecheck, production build, and 17 regression tests covering archive integrity, conflict remapping, retained versions, generated-code restrictions, and generation event parsing.
- Real screenshot generation with the selected `openai-codex/gpt-6.1-sol` model through OMP SDK 18.20.2; interactive tabs, keyboard navigation, and immediate content updates in the browser.
- Runnable exports built independently, including an actual model-generated component.
- Browser screenshot import/cropping, search, and archive restore; sandbox parent/cookie access and fetch connections denied.
- Responsive library captures at 375, 1280, 1440, and 1920 pixels; rendered design checks passed with one documented exception for full-image click targets.
- The app header stays pinned while scrolling on desktop and mobile.

## Icon attribution

The header and favicons use [Lucide's Boxes icon](https://lucide.dev/icons/boxes), licensed under [ISC](https://lucide.dev/license). The original license notice is retained in `public/favicon.svg`. The SVG favicon adapts to light and dark browser themes, with a 32px PNG fallback.

## Publishing safely

Keep `.env*`, `.data/`, `.hallmark/`, `.verification/`, database files, and backup/export archives out of source control. The ignore rules exclude these local files, dependency/build outputs, and common credential files. Generation credentials come from your existing OMP account storage, not from this repository. Do not add API keys, private screenshots, or library backups to public commits.
