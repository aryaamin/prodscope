export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getSessionId(): string {
  const key = "__prodscope_sid";
  let sid = sessionStorage.getItem(key);
  if (!sid) {
    sid = generateId();
    sessionStorage.setItem(key, sid);
  }
  return sid;
}

export function now(): string {
  return new Date().toISOString();
}
