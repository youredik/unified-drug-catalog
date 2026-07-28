import { describe, expect, it } from 'vitest';
import { parserLimitsSchema } from '@catalog/domain';
import { parseJsonSafely } from './parsers/json.ts';
import { parseXmlSafely } from './parsers/xml.ts';
import { blockedReason, isHostAllowed } from './transports/address-guard.ts';

const limits = parserLimitsSchema.parse({ maxBytes: 64 * 1024, maxDepth: 16 });

/**
 * Фид приходит от третьей стороны. Эти тесты — не гигиена, а проверка того,
 * что защита действительно срабатывает: конфигурация без такого теста
 * доказывает только собственное существование.
 */
describe('недоверенный XML', () => {
  it('XXE с внешней сущностью отвергается до разбора', () => {
    const xxe = `<?xml version="1.0"?>
      <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
      <medicines><medicine><title>&xxe;</title></medicine></medicines>`;
    const r = parseXmlSafely(xxe, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('forbidden_xml_construct');
  });

  it('Billion Laughs отвергается по наличию DOCTYPE, не по результату разворота', () => {
    // Важно, что отказ происходит ДО парсера: ждать, пока бомба развернётся,
    // и ловить нехватку памяти — не защита.
    const bomb = `<?xml version="1.0"?>
      <!DOCTYPE lolz [
        <!ENTITY lol "lol">
        <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
        <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
        <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
      ]>
      <medicines>&lol3;</medicines>`;
    const r = parseXmlSafely(bomb, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('forbidden_xml_construct');
  });

  it('внешняя ссылка через SYSTEM отвергается', () => {
    const r = parseXmlSafely('<x SYSTEM "http://169.254.169.254/">y</x>', limits);
    expect(r.ok).toBe(false);
  });

  it('вход сверх лимита отвергается по размеру, а не по содержимому', () => {
    const big = `<medicines>${'<medicine><title>x</title></medicine>'.repeat(5000)}</medicines>`;
    const r = parseXmlSafely(big, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('input_too_large');
  });

  it('нормальный фид по-прежнему разбирается', () => {
    const ok = '<medicines><medicine><externalId>b-1</externalId></medicine></medicines>';
    expect(parseXmlSafely(ok, limits).ok).toBe(true);
  });
});

describe('недоверенный JSON', () => {
  it('слишком глубокая вложенность отвергается', () => {
    const deep = '['.repeat(64) + ']'.repeat(64);
    const r = parseJsonSafely(deep, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nesting_too_deep');
  });

  it('битый JSON даёт типизированную ошибку, а не исключение наружу', () => {
    const r = parseJsonSafely('{ не json', limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('malformed_payload');
  });

  it('нормальный документ разбирается', () => {
    expect(parseJsonSafely('[{"id":"a-1"}]', limits).ok).toBe(true);
  });
});

describe('SSRF: проверка адреса назначения', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'частная сеть'],
    ['172.16.0.1', 'частная сеть'],
    ['192.168.1.1', 'частная сеть'],
    ['169.254.169.254', 'метадата облака'],
    ['0.0.0.0', 'this-network'],
    ['100.64.0.1', 'CGNAT'],
    ['::1', 'loopback IPv6'],
    ['fd00::1', 'ULA IPv6'],
    ['fe80::1', 'link-local IPv6'],
  ])('%s заблокирован (%s)', (ip) => {
    expect(blockedReason(ip)).toBeDefined();
  });

  it('IPv4-mapped адрес не обходит проверку', () => {
    // ::ffff:127.0.0.1 — тот же loopback, записанный иначе.
    expect(blockedReason('::ffff:127.0.0.1')).toBeDefined();
    expect(blockedReason('::ffff:10.0.0.1')).toBeDefined();
  });

  it('публичные адреса пропускаются', () => {
    expect(blockedReason('93.184.216.34')).toBeUndefined();
    expect(blockedReason('2606:2800:220:1:248:1893:25c8:1946')).toBeUndefined();
  });

  it('allowlist работает по точному имени и по поддоменной маске', () => {
    expect(isHostAllowed('feeds.chain-a.example', ['feeds.chain-a.example'])).toBe(true);
    expect(isHostAllowed('a.feeds.example', ['*.feeds.example'])).toBe(true);
    expect(isHostAllowed('evil.example', ['feeds.chain-a.example'])).toBe(false);
    // Не должен ловиться суффиксом: `notfeeds.example` не входит в `*.feeds.example`
    expect(isHostAllowed('notfeeds.example', ['*.feeds.example'])).toBe(false);
  });
});
