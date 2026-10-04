/** Client-side fetch wrapper that attaches the per-launch token the server embedded in the page. */
export function apiPost(url: string, body: unknown): Promise<Response> {
  let token = "";
  try {
    token =
      document
        .querySelector('meta[name="daggler-token"]')
        ?.getAttribute("content") ?? "";
  } catch {
    // no document (SSR) — request will be rejected by the server guard
  }
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-daggler-token": token },
    body: JSON.stringify(body),
  });
}
