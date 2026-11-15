import { networkConfig } from "./network";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import ts from "typescript";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { ComponentConfig, PreviewArtifact, Recipe } from "../shared/types";
import type { Store } from "./contracts";
import { InputError } from "./validation";

const require = createRequire(import.meta.url);
const artifacts = new Map<
  string,
  { html: string; createdAt: number; nonce: string }
>();
const MAX_SOURCE = 160_000;
export const exportConfigTypes = `export interface AssetValue { id: string; name: string; src: string }
export interface ComponentConfig { content: Record<string,string>; colors: { background:string; foreground:string; primary:string; muted:string }; fontFamily:string; fontSize:number; spacing:number; radius:number; assets:AssetValue[] }
`;
export const baseStyles = `html,body,#root{min-height:100%;margin:0}*{box-sizing:border-box}body{font-family:var(--font-family,system-ui);font-size:var(--font-size,16px);background:var(--color-background);color:var(--color-foreground)}button,input,textarea,select{font:inherit}button,a,input,textarea,select{touch-action:manipulation}:focus-visible{outline:2px solid var(--color-primary);outline-offset:3px}img{max-width:100%;height:auto}`;
export const tokenTheme =
  "@theme { --color-background: #f5f3ed; --color-foreground: #23251f; --color-primary: #a7472b; --color-muted: #736f65; }";

export function validateGeneratedCode(code: string): void {
  if (typeof code !== "string" || !code.trim() || code.length > MAX_SOURCE)
    throw new InputError("Component source must contain 1–160000 characters.");
  const source = ts.createSourceFile(
    "Component.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics = (
    source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics.length)
    throw new InputError(
      `Invalid TypeScript/JSX: ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, " ")}`,
    );
  let defaultName: string | undefined;
  let component:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression
    | undefined;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "react"
      )
        throw new InputError("Only imports from react are permitted.");
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
      throw new InputError("Re-exported modules are not permitted.");
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      if (statement.name?.text !== "Component")
        throw new InputError("Default export must be named Component.");
      component = statement;
    }
    if (ts.isExportAssignment(statement)) {
      if (
        !ts.isIdentifier(statement.expression) ||
        statement.expression.text !== "Component"
      )
        throw new InputError("Default export must be Component.");
      defaultName = statement.expression.text;
    }
  }
  if (defaultName) {
    for (const statement of source.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === defaultName
      )
        component = statement;
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === defaultName &&
            declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
          )
            component = declaration.initializer;
        }
    }
  }
  if (
    !component ||
    component.parameters.length !== 1 ||
    !ts.isObjectBindingPattern(component.parameters[0]!.name) ||
    !component.parameters[0]!.name.elements.some(
      (e) => (e.propertyName ?? e.name).getText(source) === "config",
    )
  )
    throw new InputError(
      "Required contract: export default function Component({config}: {config: ComponentConfig}).",
    );
  function inspect(node: ts.Node): void {
    if (
      ts.isImportEqualsDeclaration(node) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            ["require", "eval", "Function"].includes(node.expression.text)))) ||
      (ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["Function", "Worker", "SharedWorker"].includes(node.expression.text))
    )
      throw new InputError(
        "Dynamic imports, execution, workers, and require are not permitted.",
      );
    ts.forEachChild(node, inspect);
  }
  inspect(source);
}

export async function resolveConfig(
  store: Store,
  recipe: Recipe,
): Promise<ComponentConfig> {
  const config = structuredClone(recipe.config);
  config.assets = [];
  let total = 0;
  for (const id of recipe.assetIds) {
    const media = store.getMedia(id);
    if (
      !media ||
      !["image/png", "image/jpeg", "image/webp"].includes(media.mime)
    )
      throw new InputError("A selected image asset is unavailable.");
    total += media.size;
    if (total > 40_000_000)
      throw new InputError("Preview image assets exceed the size limit.", 413);
    config.assets.push({
      id,
      name: media.name,
      src: `data:${media.mime};base64,${Buffer.from(await store.mediaBytes(id)).toString("base64")}`,
    });
  }
  return config;
}

export async function compileStyles(code: string): Promise<string> {
  const compiler = await compile(
    `@import "tailwindcss" source(none);\n${tokenTheme}`,
    {
      base: dirname(require.resolve("tailwindcss/package.json")),
      onDependency: () => {},
    },
  ).catch(() => {
    throw new InputError("The local Tailwind stylesheet could not compile.");
  });
  const candidates = new Scanner({ sources: [] }).scanFiles([
    { content: code, extension: "tsx" },
  ]);
  const css = compiler.build(candidates);
  if (css.length > 1_500_000)
    throw new InputError("Generated styles exceed the preview limit.");
  return `${css}\n${baseStyles}`;
}

export const configRuntime = `function applyTokens(config: ComponentConfig){const s=document.documentElement.style;for(const [key,value] of Object.entries(config.colors))s.setProperty('--color-'+key,String(value));s.setProperty('--font-family',String(config.fontFamily));s.setProperty('--font-size',Number(config.fontSize)+'px');s.setProperty('--component-spacing',Number(config.spacing)+'px');s.setProperty('--radius',Number(config.radius)+'px');}`;

export async function compilePreview(
  store: Store,
  code: string,
  recipe: Recipe,
): Promise<PreviewArtifact> {
  validateGeneratedCode(code);
  const config = await resolveConfig(store, recipe);
  const css = await compileStyles(code);
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Component from 'btools:component';
const initial=${JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(
      /\u2029/g,
      "\\u2029",
    )};let config=initial;const root=createRoot(document.getElementById('root'));${configRuntime}
const report=(message)=>parent.postMessage({type:'btools:preview-error',message:String(message).slice(0,1200)},'*');
addEventListener('error',e=>report(e.message));addEventListener('unhandledrejection',e=>report(e.reason?.message||'Unhandled component error'));
class Boundary extends React.Component{state={error:false};static getDerivedStateFromError(){return {error:true}}componentDidCatch(e){report(e.message)}render(){return this.state.error?React.createElement('p',{role:'alert'},'Component runtime error. See the editor for details.'):this.props.children}}
function render(){applyTokens(config);root.render(React.createElement(Boundary,{key:JSON.stringify(config)},React.createElement(Component,{config})))}
addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='btools:config')return;const next=e.data.config;if(!next||typeof next!=='object'||!next.colors||!next.content)return;config={...next,assets:initial.assets};render()});render();parent.postMessage({type:'btools:ready'},'*');`;
  const bundled = await build({
    stdin: {
      contents: entry,
      sourcefile: "preview.tsx",
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
    plugins: [
      {
        name: "isolated-component",
        setup(builder) {
          builder.onResolve({ filter: /^btools:component$/ }, () => ({
            path: "Component.tsx",
            namespace: "generated",
          }));
          builder.onLoad({ filter: /.*/, namespace: "generated" }, () => ({
            contents: code,
            loader: "tsx",
            resolveDir: process.cwd(),
          }));
          builder.onResolve(
            { filter: /.*/, namespace: "generated" },
            (args) => {
              if (
                ![
                  "react",
                  "react/jsx-runtime",
                  "react/jsx-dev-runtime",
                ].includes(args.path)
              )
                return {
                  errors: [{ text: "Only React imports are permitted." }],
                };
              return { path: require.resolve(args.path) };
            },
          );
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.importer === "" || args.namespace === "generated") return;
            if (
              args.importer.endsWith("preview.tsx") &&
              !["react", "react-dom/client", "react/jsx-runtime"].includes(
                args.path,
              )
            )
              return { errors: [{ text: "Unapproved preview dependency." }] };
          });
        },
      },
    ],
  }).catch(() => {
    throw new InputError(
      "Component compilation failed. Check the React/TSX source and permitted imports.",
    );
  });
  const javascript = bundled.outputFiles?.[0]?.text;
  if (!javascript || javascript.length > 2_000_000)
    throw new Error(
      "The component could not be bundled within preview limits.",
    );
  const id = crypto.randomUUID();
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(24)),
  ).toString("base64");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Component preview</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><script nonce="${nonce}">${javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  for (const [key, value] of artifacts)
    if (Date.now() - value.createdAt > 3_600_000) artifacts.delete(key);
  while (artifacts.size >= 40) artifacts.delete(artifacts.keys().next().value!);
  artifacts.set(id, { html, nonce, createdAt: Date.now() });
  return {
    id,
    url: `${networkConfig().previewOrigin}/preview/${id}`,
  };
}

export async function previewFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = /^\/preview\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
  const artifact = id ? artifacts.get(id) : undefined;
  if (
    request.method !== "GET" ||
    !artifact ||
    Date.now() - artifact.createdAt > 3_600_000
  )
    return new Response("Preview expired or not found.", { status: 404 });
  const origins = [...networkConfig().appOrigins].join(" ");
  return new Response(artifact.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${artifact.nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; frame-ancestors ${origins}; form-action 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'`,
    },
  });
}
