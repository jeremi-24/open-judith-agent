// Reminders and alarms Judith keeps herself. They are saved on disk, so they
// survive a restart (Claude Code's own scheduled prompts die with its
// session); one missed while Judith was off is given as soon as she starts.
// A reminder: { id, at (ISO string), text }.

const MAX_AHEAD_MS = 366 * 24 * 3600 * 1000;

// "17:00", "17h", "17h30", or a full local date "2026-11-02T08:30".
// A time already passed today means tomorrow.
export function parseWhen(when, now = new Date()) {
  const s = String(when ?? '').trim();
  const time = s.match(/^(\d{1,2})\s*(?:[:hH]\s*(\d{2})?)?$/);
  if (time) {
    const [hours, minutes] = [Number(time[1]), Number(time[2] ?? 0)];
    if (hours > 23 || minutes > 59) return null;
    const at = new Date(now);
    at.setHours(hours, minutes, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  }
  const at = new Date(s);
  return Number.isNaN(at.getTime()) ? null : at;
}

// → { list, reminder } or { error }.
export function addReminder(list, { when, text }, now = new Date()) {
  const at = parseWhen(when, now);
  if (!at) return { error: `"${when}" is not a time or a date.` };
  if (at <= now) return { error: 'That time is already past.' };
  if (at - now > MAX_AHEAD_MS) return { error: 'That is more than a year away.' };
  const reminder = { id: `r${now.getTime().toString(36)}${list.length}`, at: at.toISOString(), text: String(text ?? '').trim() || 'Rappel' };
  return { list: [...list, reminder].sort((a, b) => a.at.localeCompare(b.at)), reminder };
}

// The reminders whose time has come, and the others.
export function dueReminders(list, now = new Date()) {
  const due = list.filter((r) => new Date(r.at) <= now);
  return { due, rest: list.filter((r) => !due.includes(r)) };
}

// "à 17:00", "demain à 08:30", "le 12/11 à 09:00": how Judith says when.
export function describeWhen(at, now = new Date()) {
  const date = new Date(at);
  const hm = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(date) - day(now)) / 86400000);
  if (days === 0) return `à ${hm}`;
  if (days === 1) return `demain à ${hm}`;
  return `le ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${hm}`;
}
