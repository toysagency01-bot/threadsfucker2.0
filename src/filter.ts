export function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}

export function containsExactPhrase(text: string, phrase: string): boolean {
  return normalize(text).includes(normalize(phrase));
}

export function parseTimestamp(value: string | undefined): Date | null {
  if (!value) return null;

  const trimmed = value.trim();
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;

  const lower = trimmed.toLocaleLowerCase('ru-RU');
  const now = new Date();
  if (/(только что|сейчас|just now|now)/i.test(lower)) return now;

  const match = lower.match(/(\d+)\s*(с|сек|секунд|м|мин|минут|ч|час|часа|часов|д|день|дня|дней|day|days|hour|hours|minute|minutes|m|h|d)\b/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLocaleLowerCase('ru-RU');
  let milliseconds = 0;
  if (/^(с|сек|секунд)$/.test(unit)) milliseconds = amount * 1000;
  else if (/^(м|мин|минут|m|minute|minutes)$/.test(unit)) milliseconds = amount * 60_000;
  else if (/^(ч|час|часа|часов|h|hour|hours)$/.test(unit)) milliseconds = amount * 3_600_000;
  else if (/^(д|день|дня|дней|d|day|days)$/.test(unit)) milliseconds = amount * 86_400_000;
  else return null;

  return new Date(now.getTime() - milliseconds);
}

export function isRecentTimestamp(
  value: string | undefined,
  maxAgeMinutes: number,
  now = new Date(),
): boolean {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return false;

  const age = now.getTime() - timestamp.getTime();
  return age >= -5 * 60_000 && age <= maxAgeMinutes * 60_000;
}
