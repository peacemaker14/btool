import type { MediaFile } from "../../shared/types";
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch("/api" + path, { ...options, headers });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Request failed (" + response.status + ").");
  return value as T;
}
export const json = (value: unknown) => JSON.stringify(value);
export async function uploadMedia(files: File[]): Promise<MediaFile[]> {
  const data = new FormData();
  files.forEach((file) => data.append("files", file));
  return api<MediaFile[]>("/media", { method: "POST", body: data });
}
export const mediaUrl = (id: string) => "/api/media/" + encodeURIComponent(id);
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something failed. Try again.";
export function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
