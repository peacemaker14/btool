import { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import type { Design, DesignVersion, Recipe } from "../shared/types";
import type { Store } from "./contracts";
import { InputError } from "./validation";
import {
  baseStyles,
  compileStyles,
  configRuntime,
  exportConfigTypes,
  tokenTheme,
  validateGeneratedCode,
} from "./preview";

export function selectExportVersion(
  store: Store,
  designId: string,
  versionId?: string,
): { design: Design; version: DesignVersion; recipe: Recipe } {
  const design = store.get<Design>("designs", designId);
  if (!design) throw new InputError("Design not found.", 404);
  const selectedId = versionId ?? design.currentVersionId;
  const version = design.versions.find((item) => item.id === selectedId);
  if (!version)
    throw new InputError(
      "No generated source exists for the selected version.",
      404,
    );
  // Current source is paired with latest saved controls; historical versions
  // retain the complete immutable recipe that generated/compiled their source.
  const recipe =
    selectedId === design.currentVersionId ? design.recipe : version.recipe;
  return { design, version, recipe };
}

export function createExportRoutes(store: Store): Hono {
  const app = new Hono();
  app.get("/designs/:id/source", (c) => {
    const { version } = selectExportVersion(
      store,
      c.req.param("id"),
      c.req.query("versionId"),
    );
    return c.json({ code: version.code });
  });
  app.get("/designs/:id/export", async (c) => {
    const format = c.req.query("format") ?? "project";
    if (format !== "project" && format !== "source")
      throw new InputError("Export format must be project or source.");
    const { version, recipe } = selectExportVersion(
      store,
      c.req.param("id"),
      c.req.query("versionId"),
    );
    validateGeneratedCode(version.code);
    const css = await compileStyles(version.code);
    const files: Record<string, Uint8Array> = {};
    const config = structuredClone(recipe.config);
    config.assets = [];
    let totalBytes = 0;
    for (const id of recipe.assetIds) {
      const media = store.getMedia(id);
      if (
        !media ||
        !["image/png", "image/jpeg", "image/webp"].includes(media.mime)
      )
        throw new InputError(
          "A version asset is unavailable; export cannot proceed.",
        );
      const extension =
        media.mime === "image/png"
          ? "png"
          : media.mime === "image/jpeg"
            ? "jpg"
            : "webp";
      const assetPath = `assets/${id}.${extension}`;
      const bytes = await store.mediaBytes(id);
      totalBytes += bytes.byteLength;
      if (totalBytes > 100_000_000)
        throw new InputError(
          "Export assets exceed the archive size limit.",
          413,
        );
      files[format === "project" ? `public/${assetPath}` : assetPath] = bytes;
      config.assets.push({
        id,
        name: media.name,
        src: format === "project" ? `/${assetPath}` : `./${assetPath}`,
      });
    }
    const exportRecipe = structuredClone(recipe);
    exportRecipe.config = config;
    files["recipe.json"] = strToU8(JSON.stringify(exportRecipe, null, 2));
    if (format === "source") {
      files["Component.tsx"] = strToU8(version.code);
      files["config.json"] = strToU8(JSON.stringify(config, null, 2));
      files["types.ts"] = strToU8(exportConfigTypes);
      files["styles.css"] = strToU8(css);
      files["runtime.ts"] = strToU8(
        `import type {ComponentConfig} from './types';\nexport ${configRuntime}\n`,
      );
      files["integration.txt"] = strToU8(
        "Install react@^19.1.0 and react-dom@^19.1.0 (TypeScript JSX runtime: react-jsx). Import Component from Component.tsx, config from config.json, styles.css, and {applyTokens} from runtime.ts. Call applyTokens(config) before rendering <Component config={config} /> and whenever configuration changes. Serve the assets folder beside config.json or rewrite its relative src values for your host. The shared ComponentConfig interface is in types.ts. styles.css includes base styles and compiled Tailwind utilities; no CDN or runtime compiler is needed.",
      );
    } else {
      files["src/Component.tsx"] = strToU8(version.code);
      files["src/config.json"] = strToU8(JSON.stringify(config, null, 2));
      files["src/types.ts"] = strToU8(exportConfigTypes);
      files["src/styles.css"] = strToU8(
        `@import "tailwindcss";\n${tokenTheme}\n${baseStyles}\n`,
      );
      files["src/main.tsx"] = strToU8(
        `import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport Component from './Component';\nimport config from './config.json';\nimport type {ComponentConfig} from './types';\nimport './styles.css';\n${configRuntime}\napplyTokens(config as ComponentConfig);\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><Component config={config as ComponentConfig}/></React.StrictMode>);\n`,
      );
      files["index.html"] = strToU8(
        '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Exported component</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      );
      files["vite.config.ts"] = strToU8(
        "import {defineConfig} from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nexport default defineConfig({plugins:[react(),tailwindcss()]});\n",
      );
      files["package.json"] = strToU8(
        JSON.stringify(
          {
            name: "btools-component",
            private: true,
            version: "1.0.0",
            type: "module",
            scripts: {
              dev: "vite --host 127.0.0.1",
              build: "tsc --noEmit && vite build",
              preview: "vite preview --host 127.0.0.1",
            },
            dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" },
            devDependencies: {
              "@types/react": "^19.1.0",
              "@types/react-dom": "^19.1.0",
              "@vitejs/plugin-react": "^4.7.0",
              "@tailwindcss/vite": "^4.1.0",
              tailwindcss: "^4.1.0",
              typescript: "^5.9.0",
              vite: "^6.3.0",
            },
          },
          null,
          2,
        ),
      );
      files["tsconfig.json"] = strToU8(
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "Bundler",
              jsx: "react-jsx",
              strict: true,
              skipLibCheck: true,
              esModuleInterop: true,
              resolveJsonModule: true,
              noEmit: true,
              lib: ["ES2022", "DOM", "DOM.Iterable"],
              types: ["vite/client"],
            },
            include: ["src", "vite.config.ts"],
          },
          null,
          2,
        ),
      );
      files["run.txt"] = strToU8(
        "Install dependencies with bun install or npm install. Run bun run dev (or npm run dev). Production: bun run build and bun run preview. Configuration lives in src/config.json; owned image assets live in public/assets. The component default export takes {config: ComponentConfig}; its shared interface is in src/types.ts. Tailwind is compiled locally through Vite. No btools server, API keys, reference screenshots, or absolute local paths are required.",
      );
    }
    const zip = zipSync(files, { level: 6 });
    return new Response(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="btools-${format}-${version.id}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  return app;
}
