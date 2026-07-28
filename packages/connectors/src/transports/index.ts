/**
 * Транспорты — первая из трёх независимых осей приёма.
 *
 *   transport   откуда берём байты
 *   format      как их разбираем      (parsers/)
 *   mapping     как кладём в канон    (acl/)
 *
 * «В разных форматах И через разные источники» — это разные вещи,
 * и смешивать их в один «адаптер источника» значит платить за каждую новую
 * сеть заново.
 *
 * Чтение всегда потоковое: фид на сотни мегабайт не должен класть процесс.
 * Порт возвращает асинхронный итератор, а не строку, — размер входа перестаёт
 * влиять на потребление памяти.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { err, ok, type Result, type Transport, type TransportError } from '@catalog/domain';
import { blockedReason, isHostAllowed } from './address-guard.ts';

export interface TransportPort {
  /** Потоково; вызывающий сам решает, буферизовать ли. */
  chunks(): AsyncIterable<Buffer>;
  describe(): string;
}

class FileTransport implements TransportPort {
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  async *chunks(): AsyncIterable<Buffer> {
    for await (const chunk of createReadStream(this.path)) yield chunk as Buffer;
  }
  describe(): string { return `file:${this.path}`; }
}

class HttpTransport implements TransportPort {
  private readonly url: URL;
  private readonly pinnedAddress: string;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(url: URL, pinnedAddress: string, headers: Readonly<Record<string, string>>) {
    this.url = url;
    this.pinnedAddress = pinnedAddress;
    this.headers = headers;
  }

  async *chunks(): AsyncIterable<Buffer> {
    // Соединение идёт на уже проверенный адрес; имя передаётся заголовком Host,
    // чтобы виртуальный хостинг продолжал работать. Повторного резолва нет —
    // именно он и есть окно для подмены DNS.
    const pinned = new URL(this.url);
    pinned.hostname = this.pinnedAddress;

    const response = await fetch(pinned, {
      headers: { ...this.headers, host: this.url.hostname },
      redirect: 'error', // редирект = новый адрес = новая проверка; здесь запрещаем
    });
    if (!response.ok || response.body === null) {
      throw new Error(`HTTP ${response.status} при загрузке ${this.url.hostname}`);
    }
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      yield Buffer.from(chunk);
    }
  }

  describe(): string { return `http:${this.url.hostname}@${this.pinnedAddress}`; }
}

export const openTransport = async (
  t: Transport,
): Promise<Result<TransportPort, TransportError>> => {
  switch (t.type) {
    case 'file': {
      try {
        await stat(t.path);
      } catch (e: unknown) {
        return err({ kind: 'source_unreachable', detail: `${t.path}: ${String(e)}` });
      }
      return ok(new FileTransport(t.path));
    }

    case 'http': {
      const url = new URL(t.url);

      if (!isHostAllowed(url.hostname, t.allowedHosts)) {
        return err({
          kind: 'blocked_address',
          host: url.hostname,
          resolved: '—',
          reason: 'хост отсутствует в allowlist манифеста',
        });
      }

      let address: string;
      try {
        const resolved = await lookup(url.hostname);
        address = resolved.address;
      } catch (e: unknown) {
        return err({ kind: 'source_unreachable', detail: `DNS: ${String(e)}` });
      }

      const reason = blockedReason(address);
      if (reason !== undefined) {
        return err({ kind: 'blocked_address', host: url.hostname, resolved: address, reason });
      }

      return ok(new HttpTransport(url, address, t.headers ?? {}));
    }

    case 'sftp':
    case 's3':
      // Порт объявлен, адаптер не реализован: заданию не нужен, а заглушка,
      // притворяющаяся рабочей, хуже честного отказа.
      return err({
        kind: 'source_unreachable',
        detail: `транспорт ${t.type} объявлен в модели, но адаптер не реализован`,
      });
  }
};

/** Собирает поток в строку — для источников, чей размер заведомо мал. */
export const readAllText = async (port: TransportPort): Promise<string> => {
  const parts: Buffer[] = [];
  for await (const chunk of port.chunks()) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
};

export { blockedReason, isHostAllowed } from './address-guard.ts';
