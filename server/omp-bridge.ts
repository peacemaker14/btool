import {
  streamSimple,
  type ImageContent,
  type TextContent,
  type ProviderSessionState,
} from "@oh-my-pi/pi-ai";
import { discoverAuthStorage } from "@oh-my-pi/pi-ai/auth-broker/discover";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";

export interface CatalogModel {
  selector: string;
  provider: string;
  id: string;
  name: string;
  input: ("text" | "image")[];
  reasoning: boolean;
  contextWindow: number | null;
  maxTokens: number | null;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}
export interface BridgeInput {
  model: CatalogModel;
  system: string;
  content: (TextContent | ImageContent)[];
}

// This process deliberately never imports the coding-agent host, createAgentSession,
// Settings, extensions, tools, MCP, rules, skills, or workspace/context discovery.
// The SDK's default auth discovery resolver does not execute !command config values.
if (import.meta.main) {
  let stage = "The OMP SDK could not initialize existing authentication.";
  try {
    const raw = await Bun.stdin.text();
    if (raw.length > 32_000_000) throw new Error("Input limit exceeded");
    const input = JSON.parse(raw) as BridgeInput;
    const selection = input.model;
    if (
      selection.selector !== `${selection.provider}/${selection.id}` ||
      !selection.input.includes("image")
    )
      throw new Error("Invalid exact model");
    stage =
      "The selected model's exact current SDK descriptor is unavailable or not image-capable. No fallback was used.";
    // Preserve the complete current descriptor, including wire identity,
    // compatibility policy, endpoint, and transport preferences. CLI model-list
    // JSON is a display projection, not a reconstructible request descriptor.
    const model = getBundledModel(selection.provider, selection.id);
    if (
      !model ||
      model.provider !== selection.provider ||
      model.id !== selection.id ||
      !model.input.includes("image")
    )
      throw new Error("Exact model descriptor unavailable");
    stage =
      "Existing OMP authentication is unavailable. Sign in with OMP, then retry.";
    const auth = await discoverAuthStorage();
    const sessionId = crypto.randomUUID();
    const resolver = auth.keys.resolver(selection.provider, {
      sessionId,
      baseUrl: model.baseUrl,
      modelId: selection.id,
    });
    stage =
      "The selected OMP model request failed. Check model access and existing OMP authentication; no fallback was used.";
    const stream = streamSimple(
      model,
      {
        systemPrompt: [input.system],
        messages: [
          { role: "user", content: input.content, timestamp: Date.now() },
        ],
        tools: [],
      },
      {
        apiKey: resolver,
        sessionId,
        providerSessionState: new Map<string, ProviderSessionState>(),
        preferWebsockets: model.preferWebsockets,
        signal: AbortSignal.timeout(180_000),
        maxTokens: Math.min(model.maxTokens ?? 24_000, 24_000),
        reasoning: Effort.Medium,
        hideThinkingSummary: true,
        toolChoice: "none",
        cacheRetention: "none",
      },
    );
    let done = false;
    for await (const event of stream) {
      if (event.type.startsWith("toolcall"))
        throw new Error("Unexpected tool call");
      if (event.type === "error") {
        const detail = (event.error.errorMessage || "Provider rejected the request.")
          .replace(/(?:Bearer\s+|sk-|eyJ)[A-Za-z0-9_./+=-]+/gi, "[redacted]")
          .replace(/https?:\/\/[^\s]+/gi, "[provider endpoint]")
          .replace(/\/(?:Users|home|private|tmp)\/[^\s]+/g, "[local path]")
          .slice(0, 500);
        stage = `OMP provider request failed${event.error.errorStatus ? " (HTTP " + event.error.errorStatus + ")" : ""}: ${detail} No fallback was used.`;
        throw new Error("Provider request failed");
      }
      if (event.type === "text_delta")
        process.stdout.write(
          `${JSON.stringify({ type: "text_delta", delta: event.delta })}\n`,
        );
      if (event.type === "done") {
        if (
          event.reason !== "stop" ||
          event.message.content.some((item) => item.type === "toolCall")
        )
          throw new Error("Incomplete response");
        const text = event.message.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("");
        process.stdout.write(`${JSON.stringify({ type: "done", text })}\n`);
        done = true;
      }
    }
    if (!done) throw new Error("Missing completed response");
    process.exit(0);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ type: "error", message: stage })}\n`,
    );
    process.exit(1);
  }
}
