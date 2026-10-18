// The admin's current meet is remembered per browser. Storage can be missing or throw (private windows), so never rely on it.
import type { MeetInfo } from './data/meet-store';

export const SELECTED_MEET_KEY = 'ucg-lineups:meet';

export function readSelectedMeet(): string | null {
  try { return window.localStorage.getItem(SELECTED_MEET_KEY); } catch { return null; }
}

export function writeSelectedMeet(id: string): void {
  try { window.localStorage.setItem(SELECTED_MEET_KEY, id); } catch { /* the choice just isn't remembered */ }
}

/** Meets the switcher offers: not archived, newest first (the list is already sorted). */
export function visibleMeets(meets: MeetInfo[]): MeetInfo[] {
  return meets.filter((m) => !m.archived);
}

/** The remembered meet when it is still visible, otherwise the newest visible one, otherwise null. */
export function pickMeet(meets: MeetInfo[], saved: string | null): string | null {
  const vis = visibleMeets(meets);
  return vis.find((m) => m.id === saved)?.id ?? vis[0]?.id ?? null;
}
