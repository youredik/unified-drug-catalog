/**
 * Защита от SSRF при загрузке фида по адресу из конфигурации.
 *
 * Списка разрешённых хостов НЕДОСТАТОЧНО. Классический обход — подмена DNS
 * между проверкой и подключением (CVE-2026-54353 ровно на этом): имя проходит
 * валидацию, отдав публичный адрес, а сокет резолвит заново и получает
 * внутренний. Поэтому здесь три слоя:
 *
 *   1) хост обязан быть в allowlist манифеста;
 *   2) имя резолвится ОДИН раз, полученный адрес проверяется;
 *   3) соединение идёт на уже проверенный адрес — повторного резолва нет.
 *
 * Четвёртый слой — egress-политика контейнера — живёт вне кода и страхует
 * от ошибок в первых трёх.
 */

import { isIP } from 'node:net';

/** Диапазоны, ходить в которые извне нельзя ни при каких настройках. */
export const blockedReason = (ip: string): string | undefined => {
  const v = isIP(ip);
  if (v === 0) return 'не является IP-адресом';

  if (v === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = [parts[0]!, parts[1]!];
    if (a === 0) return 'this-network 0.0.0.0/8';
    if (a === 10) return 'частная сеть 10.0.0.0/8';
    if (a === 127) return 'loopback 127.0.0.0/8';
    if (a === 169 && b === 254) return 'link-local 169.254.0.0/16 (включая метадату облака)';
    if (a === 172 && b >= 16 && b <= 31) return 'частная сеть 172.16.0.0/12';
    if (a === 192 && b === 168) return 'частная сеть 192.168.0.0/16';
    if (a === 192 && b === 0) return 'служебный диапазон 192.0.0.0/24';
    if (a === 100 && b >= 64 && b <= 127) return 'CGNAT 100.64.0.0/10';
    if (a >= 224) return 'multicast/reserved';
    return undefined;
  }

  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return 'loopback IPv6';
  if (lower.startsWith('fe80')) return 'link-local IPv6';
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'unique local IPv6';
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped: проверяем как IPv4, иначе 127.0.0.1 пролезет как ::ffff:127.0.0.1
    return blockedReason(lower.slice('::ffff:'.length));
  }
  return undefined;
};

export const isHostAllowed = (host: string, allowlist: readonly string[]): boolean =>
  allowlist.some((allowed) => {
    const a = allowed.toLowerCase();
    const h = host.toLowerCase();
    return a.startsWith('*.') ? h.endsWith(a.slice(1)) : h === a;
  });
