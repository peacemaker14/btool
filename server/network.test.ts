import { expect, test } from "bun:test";
import { networkConfig, requestOriginError } from "./network";

const appOrigin = "https://mini.example:8443";
const previewOrigin = "https://mini.example:10000";
const config = networkConfig({
  PUBLIC_APP_ORIGIN: appOrigin,
  PUBLIC_PREVIEW_ORIGIN: previewOrigin,
});

test("configured tailnet requests work without trusting arbitrary forwarded hosts or preview origins", () => {
  expect(
    requestOriginError(
      new Request(`${appOrigin}/api/settings`, {
        method: "PUT",
        headers: { Origin: appOrigin, "Sec-Fetch-Site": "same-origin" },
      }),
      config,
    ),
  ).toBeNull();
  expect(
    requestOriginError(new Request("http://127.0.0.1:4317/api/state"), config),
  ).toBeNull();
  for (const origin of [previewOrigin, "null", "https://malicious.example"]) {
    expect(
      requestOriginError(
        new Request(`${appOrigin}/api/settings`, {
          method: "PUT",
          headers: { Origin: origin },
        }),
        config,
      ),
    ).toBe("Cross-origin application access is not allowed.");
  }
  expect(
    requestOriginError(
      new Request("http://malicious.example/api/state", {
        headers: { "X-Forwarded-Host": "mini.example:8443" },
      }),
      config,
    ),
  ).toBe("Unrecognized host.");
  expect(
    requestOriginError(
      new Request(`${appOrigin}/api/state`, {
        headers: { Origin: appOrigin, "Sec-Fetch-Site": "cross-site" },
      }),
      config,
    ),
  ).toBe("Cross-origin application access is not allowed.");
});

test("remote access cannot combine trusted app and generated preview origins", () => {
  expect(() =>
    networkConfig({
      PUBLIC_APP_ORIGIN: appOrigin,
      PUBLIC_PREVIEW_ORIGIN: appOrigin,
    }),
  ).toThrow("separate origins");
  expect(() => networkConfig({ PUBLIC_APP_ORIGIN: appOrigin })).toThrow(
    "together",
  );
  for (const origin of [
    "http://mini.example:8443",
    `${appOrigin}/path`,
    `${appOrigin}?query=value`,
    "https://user:password@mini.example:8443",
  ]) {
    expect(() =>
      networkConfig({
        PUBLIC_APP_ORIGIN: origin,
        PUBLIC_PREVIEW_ORIGIN: previewOrigin,
      }),
    ).toThrow();
  }
});

test("links from other sites open the app without permitting cross-site API calls or sandbox navigation", () => {
  const headers = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };
  expect(requestOriginError(new Request(appOrigin, { headers }), config)).toBeNull();
  expect(requestOriginError(new Request(`${appOrigin}/api/settings`, { method: "POST", headers }), config)).toBe("Cross-origin application access is not allowed.");
  expect(requestOriginError(new Request(appOrigin, { headers: { ...headers, "Sec-Fetch-Dest": "iframe" } }), config)).toBe("Cross-origin application access is not allowed.");
  expect(requestOriginError(new Request(appOrigin, { headers: { ...headers, Origin: "null" } }), config)).toBe("Cross-origin application access is not allowed.");
});
