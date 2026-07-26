// M2 if-then 执行意图 → a daily-recurring .ics event. Static export means no
// push notifications and the Notification Triggers API is dead — a calendar
// event is the one zero-infrastructure reminder that actually fires. Times are
// FLOATING (no TZID): the calendar app interprets them in device-local time,
// which is exactly right for a personal daily habit.

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Build a daily-recurring reminder. `timeHHMM` like "08:00". */
export function buildReminderIcs(args: {
  summary: string;
  description: string;
  timeHHMM: string;
  nowMs: number;
}): string {
  const [h = "08", m = "00"] = args.timeHHMM.split(":");
  const now = new Date(args.nowMs);
  const p = (n: number) => String(n).padStart(2, "0");
  const startDate = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const dtStart = `${startDate}T${h.padStart(2, "0")}${m.padStart(2, "0")}00`;
  const dtStamp =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Echo//A1 Reminder//ZH",
    "BEGIN:VEVENT",
    `UID:echo-a1-daily-${args.nowMs}@echo`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    "RRULE:FREQ=DAILY",
    `SUMMARY:${escapeIcsText(args.summary)}`,
    `DESCRIPTION:${escapeIcsText(args.description)}`,
    "BEGIN:VALARM",
    "TRIGGER:PT0M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(args.summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
