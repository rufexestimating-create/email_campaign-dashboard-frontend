export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1";

const TOKEN_KEY = "auth_token";

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string | null;
  is_verified: boolean;
  created_at: string;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage blocked (private mode etc.) - session won't persist across reloads
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** fetch() against the FastAPI backend with the JWT attached. A 401 clears the session and sends the user to /login. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && token) {
    clearToken();
    window.location.href = "/login";
  }
  return res;
}

export const NETWORK_ERROR = "We couldn't connect. Please check your internet connection and try again.";
const SERVER_ERROR = "Something went wrong on our side. Please try again in a moment.";

/** Turns FastAPI error bodies (string, {code,message}, or validation error list) into one readable message. */
export function errorMessage(data: unknown, fallback = "Something went wrong"): string {
  const detail = (data as { detail?: unknown })?.detail;
  // Setup/database problems are for the developer's terminal, not the person using the app
  if (typeof detail === "string" && /^(Database|Supabase)/.test(detail)) return SERVER_ERROR;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, "");
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  return fallback;
}

export function errorCode(data: unknown): string | null {
  const detail = (data as { detail?: unknown })?.detail;
  return detail && typeof detail === "object" && "code" in detail ? String((detail as { code: unknown }).code) : null;
}
