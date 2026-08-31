export function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}

// Backward-compatible helper for repositories that still contain the original
// unit test. The monitor does not use exact matching anymore.
export function containsExactPhrase(text: string, phrase: string): boolean {
  return normalize(text).includes(normalize(phrase));
}

const BUYER_INTENT_PATTERNS = [
  /(?<!\p{L})(?:ищу|ищем)(?!\p{L})/u,
  /(?<!\p{L})(?:нужен|нужна|нужны|требуется|требуются)(?!\p{L})/u,
  /(?<!\p{L})(?:посоветуйте|порекомендуйте)(?!\p{L})/u,
  /(?<!\p{L})кто\s+(?:может|поможет|возьм[её]тся|настроит|запустит)(?!\p{L})/u,
  /(?<!\p{L})помогите\s+(?:найти|с|подобрать)(?!\p{L})/u,
  /(?<!\p{L})нужна\s+помощь(?!\p{L})/u,
  /(?<!\p{L})хочу\s+(?:запустить|настроить|заказать|продвинуть)(?!\p{L})/u,
  /(?<!\p{L})(?:есть|подскажите),?\s+(?:кто|специалист|агентство)(?!\p{L})/u,
  /\b(?:looking for|need|recommend|who can help)\b/i,
];

const MARKETING_SERVICE_PATTERNS = [
  /маркетолог/u,
  /маркетинг/u,
  /таргет/u,
  /реклам/u,
  /продвиж/u,
  /трафик/u,
  /лидоген/u,
  /контекст/u,
  /агентств/u,
  /smm|seo|ppc|meta\s+ads|google\s+ads/i,
  /привлеч\p{L}*\s+(?:новых\s+)?клиент\p{L}*/u,
  /поток\s+клиент/u,
  /новых\s+клиент/u,
  /больше\s+клиент/u,
  /заявк/u,
  /(?<!\p{L})лид(?!\p{L})/u,
  /(?:увелич\p{L}*|больш[её])\s+продаж\p{L}*/u,
  /продаж\p{L}*/u,
  /подрядчик|исполнитель/u,
];

const BUSINESS_CONTEXT_PATTERNS = [
  /для\s+(?:бизнеса|компани[ия]|проекта|магазина|бренда|сайта|клиники|салона)/u,
  /(?:мой|наш[аеи]?)\s+(?:бизнес|магазин|проект|бренд|сайт|компани[яию])/u,
  /у\s+меня\s+(?:бизнес|магазин|проект|компани[яию]|сайт)/u,
  /(?:запустить|настроить|продвинуть)\s+(?:реклам|маркетинг|продвиж)/u,
  /(?:для|в)\s+(?:привлечения|увеличения)\s+(?:клиент|продаж|заявок|лидов)/u,
  /\b(?:for my|for our)\s+(?:business|company|project|brand|store)\b/i,
];

const HUMOR_PATTERNS = [
  /мем(?:чик)?/u,
  /шутк/u,
  /прикол/u,
  /анекдот/u,
  /юмор/u,
  /ирони/u,
  /сарказм|саркаст/u,
  /рофл|ржач|жиза|кек/u,
  /смешн/u,
  /(?<!\p{L})лол(?!\p{L})/u,
  /кто\s+понял/u,
  /#(?:мем|юмор|joke|humor|marketingmemes)\b/i,
];

const EDUCATION_PATTERNS = [
  /обучени/u,
  /курс/u,
  /вебинар/u,
  /воркшоп|интенсив|мастер-класс/u,
  /сертификат|урок[аи]?/u,
];

const NETWORKING_PATTERNS = [
  /партн[её]р/u,
  /нетворкинг/u,
  /коллаборац/u,
  /взаимовыгодн/u,
  /соосновател/u,
  /единомышленник/u,
];

const VACANCY_PATTERNS = [
  /ищу\s+работ/u,
  /ваканс/u,
  /в\s+(?:нашу\s+)?команду/u,
  /в\s+штат/u,
  /в\s+(?:наше\s+)?агентств[оаеуы]?/u,
  /нанимаем|нанять|сотрудник|подбор\s+персонал/u,
  /зарплат|оклад|график\s+работ|обязанност|требован(?:ия|ие)/u,
  /опыт\s+работы|отклик|резюм|собеседован|тестов|стажировк/u,
  /#(?:hiring|marketingjobs|job|jobs|vacancy)\b/i,
  /\b(?:join|we(?:'re| are) looking for)\b.*\b(?:team|specialist|manager|coordinator)\b/i,
];

const SELF_PROMOTION_PATTERNS = [
  /(?:я|мы)\s+(?:маркетолог|таргетолог|рекламщик|специалист|агентств[оа])/u,
  /(?:оказываю|предлагаю|предоставляю)\s+(?:маркетинговые\s+)?услуг/u,
  /(?:настрою|настраиваю|запущу|запускаю|веду|продвигаю|помогаю)\s+.*(?:реклам|маркетинг|продвиж|таргет|привлекать\s+клиент)/u,
  /(?:ищу|нужны|беру|набираю)\s+(?:новых\s+)?клиент/u,
  /(?:возьму|готов[ао]?\s+взять)\s+(?:в\s+работу\s+)?(?:проект|клиент)/u,
  /(?:есть|свободн(?:ые|ых))\s+(?:места|слоты)/u,
  /(?:открыт[ао]?|готов[ао]?)\s+к\s+новым\s+(?:проектам|клиентам|заказам)/u,
  /(?:ищу\s+проекты|ищу\s+заказы|пишите\s+в\s+(?:лс|личку|директ))/u,
  /\b(?:looking for clients|seeking clients|available for new projects|open to new clients|accepting new clients|book a call|dm me)\b/i,
  /\b(?:i am|i'm|we are)\s+(?:a\s+)?(?:marketer|media buyer|marketing agency|agency)\b/i,
];

export type LeadClassificationReason =
  | 'lead'
  | 'humor'
  | 'education'
  | 'networking'
  | 'self_promotion'
  | 'vacancy'
  | 'no_buyer_intent'
  | 'insufficient_context'
  | 'empty';

export type LeadClassification = {
  matches: boolean;
  reason: LeadClassificationReason;
  score: number;
};

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyMarketingLead(text: string): LeadClassification {
  const normalized = normalize(text);
  if (!normalized) return { matches: false, reason: 'empty', score: 0 };
  if (hasAny(normalized, HUMOR_PATTERNS)) {
    return { matches: false, reason: 'humor', score: 0 };
  }
  if (hasAny(normalized, EDUCATION_PATTERNS)) {
    return { matches: false, reason: 'education', score: 0 };
  }
  if (hasAny(normalized, NETWORKING_PATTERNS)) {
    return { matches: false, reason: 'networking', score: 0 };
  }
  if (hasAny(normalized, VACANCY_PATTERNS)) {
    return { matches: false, reason: 'vacancy', score: 0 };
  }
  if (hasAny(normalized, SELF_PROMOTION_PATTERNS)) {
    return { matches: false, reason: 'self_promotion', score: 0 };
  }

  const hasBuyerIntent = hasAny(normalized, BUYER_INTENT_PATTERNS);
  if (!hasBuyerIntent) {
    return { matches: false, reason: 'no_buyer_intent', score: 0 };
  }

  const hasMarketingService = hasAny(normalized, MARKETING_SERVICE_PATTERNS);
  const hasBusinessContext = hasAny(normalized, BUSINESS_CONTEXT_PATTERNS);
  const score = 3 + (hasMarketingService ? 2 : 0) + (hasBusinessContext ? 1 : 0);

  if (hasMarketingService && score >= 5) {
    return { matches: true, reason: 'lead', score };
  }
  return { matches: false, reason: 'insufficient_context', score };
}

export function matchesMarketingLead(text: string): boolean {
  return classifyMarketingLead(text).matches;
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
