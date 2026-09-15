export {
  type Locale,
  type Messages,
  LOCALE_STORAGE_KEY,
  dictionaries,
  en,
  tr,
  isLocale,
  getMessages,
} from "./messages";

import { getMessages, type Locale } from "./messages";

/** BCP 47 tag for dates / number formatting. */
export function localeTag(locale: Locale): string {
  return locale === "tr" ? "tr-TR" : "en-US";
}

export function formatHubActivityFreshnessLabelLocalized(opts: {
  locale: Locale;
  freshness: "fresh" | "cached" | "stale";
  lastVerifiedAt: string | null | undefined;
  nowMs?: number;
}): string {
  const m = getMessages(opts.locale).freshness;

  if (opts.freshness === "fresh") {
    return m.fromPublicHub;
  }

  const raw = opts.lastVerifiedAt?.trim();
  if (!raw) {
    return m.fromPublicHub;
  }

  const then = Date.parse(raw);
  if (!Number.isFinite(then)) {
    return m.fromPublicHub;
  }

  const now = opts.nowMs ?? Date.now();
  const deltaMs = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < minute) {
    return m.fromPublicHub;
  }
  if (deltaMs < hour) {
    const mins = Math.floor(deltaMs / minute);
    return m.updatedMinAgo(mins);
  }
  if (deltaMs < day) {
    const hours = Math.floor(deltaMs / hour);
    return m.updatedHourAgo(hours);
  }

  const d = new Date(then);
  const month = m.months[d.getUTCMonth()] ?? m.months[0];
  const dayNum = d.getUTCDate();
  const year = d.getUTCFullYear();
  return m.updatedDate(month, dayNum, year);
}
