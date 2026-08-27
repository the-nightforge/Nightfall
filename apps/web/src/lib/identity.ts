export interface Identity {
  playerId: string;
  token: string;
  nickname: string;
}

const KEY = "masoi.identity";

export function getIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  window.localStorage.setItem(KEY, JSON.stringify(identity));
}

export function clearIdentity(): void {
  window.localStorage.removeItem(KEY);
}
