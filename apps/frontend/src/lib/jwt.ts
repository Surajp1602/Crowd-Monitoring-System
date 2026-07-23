interface AccessTokenClaims {
  sub: string;
  role: string;
  is_guest: boolean;
  permissions: string[];
  exp: number;
}

/**
 * Decodes a JWT payload without verifying its signature. Safe only for
 * UI-level decisions (show/hide a button) — the backend re-validates and
 * enforces permissions on every request regardless of what the client shows.
 */
export function decodeAccessToken(token: string): AccessTokenClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json) as AccessTokenClaims;
  } catch {
    return null;
  }
}
