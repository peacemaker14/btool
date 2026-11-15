import { describe, expect, test } from "bun:test";
import { parseGenerationEvents } from "./generation";
import { validateGeneratedCode } from "./preview";
import { InputError } from "./validation";

const code = `import React from 'react'; interface ComponentConfig { content: Record<string,string> } export default function Component({config}: {config: ComponentConfig}) { return <h1>{config.content.title}</h1> }`;
const payload = JSON.stringify({ code });

describe("structured generation output boundaries", () => {
  test("accepts escaped TSX from a complete matching text stream", () => {
    const stream = [
      JSON.stringify({ type: "text_delta", delta: payload.slice(0, 23) }),
      JSON.stringify({ type: "text_delta", delta: payload.slice(23) }),
      JSON.stringify({ type: "done", text: payload }),
    ].join("\r\n");
    expect(parseGenerationEvents(stream)).toBe(code);
  });
  test("rejects incomplete, conflicting, fenced, or extra-field output rather than repairing it", () => {
    expect(() =>
      parseGenerationEvents(
        JSON.stringify({ type: "text_delta", delta: payload }),
      ),
    ).toThrow();
    expect(() =>
      parseGenerationEvents(
        `${JSON.stringify({ type: "text_delta", delta: "different" })}\n${JSON.stringify({ type: "done", text: payload })}`,
      ),
    ).toThrow();
    expect(() =>
      parseGenerationEvents(
        JSON.stringify({ type: "done", text: "```json\n" + payload + "\n```" }),
      ),
    ).toThrow();
    expect(() =>
      parseGenerationEvents(
        JSON.stringify({
          type: "done",
          text: JSON.stringify({ code, shell: "do not execute" }),
        }),
      ),
    ).toThrow();
    expect(() =>
      parseGenerationEvents(
        JSON.stringify({ type: "done", text: '{"code":""}' }),
      ),
    ).toThrow();
  });
  test("surfaces a bridge failure instead of accepting partial code", () => {
    expect(() =>
      parseGenerationEvents(
        `${JSON.stringify({ type: "text_delta", delta: payload })}\n${JSON.stringify({ type: "error", message: "Selected model failed; no fallback." })}`,
      ),
    ).toThrow("Selected model failed; no fallback.");
  });
  test("enforces source and total stream size boundaries", () => {
    const maximum = "x".repeat(160_000);
    expect(
      parseGenerationEvents(
        JSON.stringify({
          type: "done",
          text: JSON.stringify({ code: maximum }),
        }),
      ),
    ).toBe(maximum);
    expect(() =>
      parseGenerationEvents(
        JSON.stringify({
          type: "done",
          text: JSON.stringify({ code: maximum + "x" }),
        }),
      ),
    ).toThrow(InputError);
    expect(() => parseGenerationEvents(" ".repeat(2_000_001))).toThrow(
      "OMP output exceeded the safety limit.",
    );
  });
});

describe("generated module compilation boundary", () => {
  test("accepts the React-only named component configuration contract", () => {
    expect(() => validateGeneratedCode(code)).not.toThrow();
  });
  test("rejects filesystem, URL, package, re-export, dynamic import, and require escape paths", () => {
    for (const source of [
      "node:fs",
      "./secret.ts",
      "/etc/passwd",
      "https://example.com/script.js",
      "lucide-react",
    ]) {
      expect(() =>
        validateGeneratedCode(
          `import x from ${JSON.stringify(source)};\n${code}`,
        ),
      ).toThrow();
    }
    expect(() =>
      validateGeneratedCode(`export * from 'react';\n${code}`),
    ).toThrow();
    expect(() =>
      validateGeneratedCode(`${code}\nconst load = () => import('react');`),
    ).toThrow();
    expect(() =>
      validateGeneratedCode(`${code}\nconst load = () => require('react');`),
    ).toThrow();
  });
  test("rejects missing or misnamed default component and configuration parameter", () => {
    expect(() =>
      validateGeneratedCode(
        "export default function Wrong({config}) { return null }",
      ),
    ).toThrow();
    expect(() =>
      validateGeneratedCode(
        "export default function Component(props) { return null }",
      ),
    ).toThrow();
    expect(() =>
      validateGeneratedCode(
        "export default function Component() { return null }",
      ),
    ).toThrow();
  });
  test("reports invalid TypeScript and oversized source as input errors", () => {
    expect(() =>
      validateGeneratedCode(
        "export default function Component({config}: {config: unknown}) { return <div> }",
      ),
    ).toThrow(InputError);
    expect(() => validateGeneratedCode(code + " ".repeat(160_000))).toThrow(
      InputError,
    );
  });
});
