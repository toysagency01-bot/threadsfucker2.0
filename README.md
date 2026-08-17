# Threads Toolkit → Telegram Monitor

Бесплатный вариант для GitHub Actions без Meta Graph API и без Apify-кредитов.

## Что делает

- ищет пять ключей в публичном web-поиске Threads;
- использует сортировку `recent`;
- оставляет только точное вхождение фразы в текст;
- отбрасывает replies по данным DOM/внутренних web-ответов Threads;
- оставляет посты не старше 4 часов;
- не отправляет один и тот же пост повторно;
- запускается каждые 30 минут;
- отправляет результат в Telegram.

## Что нужно добавить в GitHub Secrets

Обязательный секрет:

- `TELEGRAM_BOT_TOKEN` — токен BotFather.

Для Threads можно использовать один из вариантов:

- `THREADS_SESSION_ID` — текущий sessionid твоего Threads-аккаунта;
- `THREADS_STORAGE_STATE_JSON` — экспортированное состояние Playwright.

Если оба секрета не добавлены, скрипт попробует публичный поиск без авторизации. Авторизованная сессия нужна, если Threads покажет login wall или ограничит выдачу.

`TELEGRAM_CHAT_ID` необязателен: открой бота и нажми Start, после чего workflow найдёт личный чат через `getUpdates`.

## Как загрузить в существующий репозиторий

1. Открой свой репозиторий `threads_leadfucker`.
2. Удали старые файлы ScrapeCreators-версии или замени их содержимым этого архива.
3. Обязательно загрузи скрытую папку `.github/workflows/threads-monitor.yml`.
4. В **Settings → Actions → General → Workflow permissions** выбери **Read and write permissions**.
5. В **Actions** открой **Threads monitor** и нажми **Run workflow**.

## Важное ограничение

Это web-скрейпер, а не официальный API. Threads может менять страницу, показывать login wall или временно ограничивать выдачу. В коде есть повторные попытки и поддержка sessionid/storage state, но стабильность не гарантируется навсегда.
