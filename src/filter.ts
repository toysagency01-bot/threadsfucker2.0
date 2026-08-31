export function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}

// Backward-compatible helper for repositories that still contain the original
// unit test. The monitor does not use exact matching anymore.
export function containsExactPhrase(text: string, phrase: string): boolean {
  return normalize(text).includes(normalize(phrase));
}

const COMMERCIAL_INTENT_PATTERNS = [
  /(?<!\p{L})ищу(?!\p{L})/u,
  /(?<!\p{L})ищем(?!\p{L})/u,
  /(?<!\p{L})нужен(?!\p{L})/u,
  /(?<!\p{L})нужна(?!\p{L})/u,
  /(?<!\p{L})нужны(?!\p{L})/u,
  /(?<!\p{L})требуется(?!\p{L})/u,
  /(?<!\p{L})требуются(?!\p{L})/u,
  /(?<!\p{L})посоветуйте(?!\p{L})/u,
  /(?<!\p{L})кто\s+(?:может|поможет)(?!\p{L})/u,
  /(?<!\p{L})нужна\s+помощь(?!\p{L})/u,
];

const MARKETING_SIGNAL_PATTERNS = [
  /маркетолог/u,
  /маркетинг/u,
  /таргет/u,
  /реклам/u,
  /продвиж/u,
  /трафик/u,
  /лидоген/u,
  /контекст/u,
  /агентств/u,
  /привлечь\s+(?:новых\s+)?клиент/u,
  /найти\s+(?:новых\s+)?клиент/u,
  /поток\s+клиент/u,
  /новых\s+клиент/u,
  /больше\s+клиент/u,
  /заявк/u,
  /(?<!\p{L})лид(?!\p{L})/u,
  /увеличить\s+продаж/u,
  /больше\s+продаж/u,
];

const NON_LEAD_PATTERNS = [
  /ищу\s+работ/u,
  /ищу\s+ваканс/u,
  /ваканс/u,
  /резюм/u,
  /сопроводительн/u,
  /я\s+(?:маркетолог|таргетолог|рекламщик|специалист)/u,
  /оказываю\s+услуг/u,
  /предлагаю\s+услуг/u,
  /ищу\s+клиент/u,
  /беру\s+клиент/u,
  /обучени/u,
  /курс/u,
  /вебинар/u,
];

export function matchesMarketingLead(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (NON_LEAD_PATTERNS.some((pattern) => pattern.test(normalized))) return false;

  const hasIntent = COMMERCIAL_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasMarketingSignal = MARKETING_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
  return hasIntent && hasMarketingSignal;
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
