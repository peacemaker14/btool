export interface NetworkConfig {
  appOrigins: ReadonlySet<string>;
  appHosts: ReadonlySet<string>;
  previewOrigin: string;
}

export function networkConfig(
  env: Record<string, string | undefined> = process.env,
): NetworkConfig {
  const appOrigins = new Set(
    [env.PORT || "4317", env.DEV_PORT || "4316"].flatMap((port) =>
      ["127.0.0.1", "localhost"].map((host) => `http://${host}:${port}`),
    ),
  );
  let previewOrigin = `http://127.0.0.1:${env.PREVIEW_PORT || "4328"}`;
  if (Boolean(env.PUBLIC_APP_ORIGIN) !== Boolean(env.PUBLIC_PREVIEW_ORIGIN)) {
    throw new Error(
      "Set PUBLIC_APP_ORIGIN and PUBLIC_PREVIEW_ORIGIN together.",
    );
  }
  if (env.PUBLIC_APP_ORIGIN && env.PUBLIC_PREVIEW_ORIGIN) {
    const origins = [env.PUBLIC_APP_ORIGIN, env.PUBLIC_PREVIEW_ORIGIN].map(
      (value) => {
        const url = new URL(value);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        ) {
          throw new Error(
            "Public origins must be HTTPS origins without credentials, paths, queries, or fragments.",
          );
        }
        return url.origin;
      },
    );
    if (origins[0] === origins[1]) {
      throw new Error(
        "The app and generated previews must use separate origins.",
      );
    }
    appOrigins.add(origins[0]!);
    previewOrigin = origins[1]!;
  }
  return {
    appOrigins,
    appHosts: new Set([...appOrigins].map((origin) => new URL(origin).host)),
    previewOrigin,
  };
}

export function requestOriginError(
  request: Request,
  network: NetworkConfig,
): string | null {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!network.appHosts.has(host)) return "Unrecognized host.";
  const origin = request.headers.get("origin");
  const documentNavigation =
    request.method === "GET" &&
    !origin &&
    request.headers.get("sec-fetch-mode") === "navigate" &&
    request.headers.get("sec-fetch-dest") === "document";
  if (
    (origin && !network.appOrigins.has(origin)) ||
    (request.headers.get("sec-fetch-site") === "cross-site" && !documentNavigation)
  ) {
    return "Cross-origin application access is not allowed.";
  }
  return null;
}
