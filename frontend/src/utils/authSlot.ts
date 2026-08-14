/** 从错误文案解析 ASKME_AUTH_REQUIRED:slot=xxx */
export function parseAuthRequiredSlot(message: string): string | null {
  const match = (message || "").match(/ASKME_AUTH_REQUIRED(?::slot=([a-z0-9_-]+))?/i);
  const slot = match?.[1]?.trim().toLowerCase() || "";
  return slot || null;
}

export function collectAuthSlotsFromMessages(messages: string[]): string[] {
  const slots: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const slot = parseAuthRequiredSlot(message);
    if (!slot || seen.has(slot)) continue;
    seen.add(slot);
    slots.push(slot);
  }
  return slots;
}

export function settingsAuthPath(slot?: string | null): string {
  const id = (slot || "").trim();
  if (!id) return "/settings?tab=auth";
  return `/settings?tab=auth&slot=${encodeURIComponent(id)}`;
}
