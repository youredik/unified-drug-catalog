/**
 * Адаптеры арбитра. Порт объявлен в `@catalog/match` — у потребителя.
 *
 * Пакет не знает ни про приём данных, ни про хранение: это проверяется гейтом
 * `adjudicator-is-an-adapter`. Языковую модель можно выключить, не тронув
 * ни строки в ядре.
 */

export * from './prompt.ts';
export * from './claude.ts';
export * from './recorded.ts';
