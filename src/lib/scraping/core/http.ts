/**
 * Client HTTP pour le scraping : limitation de débit, retries, backoff.
 *
 * Pourquoi ne pas juste appeler fetch() ? Parce qu'un scraper naïf se fait
 * bannir en quelques minutes. Trois protections sont indispensables :
 *   - espacement des requêtes (on ne martèle jamais un serveur) ;
 *   - respect de l'en-tête Retry-After quand le serveur nous freine ;
 *   - backoff exponentiel avec « jitter » aléatoire, pour éviter que tous les
 *     retries retombent en même temps et créent une nouvelle rafale.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Espace le DÉMARRAGE des requêtes d'au moins 1/rps, avec un peu d'aléatoire.
 * On ne sérialise pas les réponses : plusieurs requêtes peuvent être en vol,
 * elles sont simplement lancées de façon étalée.
 */
export class RateLimiter {
  private nextAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly rps: number, private readonly jitter = 0.35) {}

  acquire(): Promise<void> {
    const interval = 1000 / this.rps;
    this.chain = this.chain.then(async () => {
      const wait = this.nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      const spread = 1 + (Math.random() - 0.5) * this.jitter;
      this.nextAt = Date.now() + interval * spread;
    });
    return this.chain;
  }
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string, message?: string) {
    super(message ?? `HTTP ${status} — ${url}`);
    this.name = 'HttpError';
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Accept-Language': 'fr-CA,fr;q=0.9,en-CA;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

export interface HttpClientOptions {
  requestsPerSecond: number;
  maxRetries?: number;
  timeoutMs?: number;
  baseHeaders?: Record<string, string>;
}

export class HttpClient {
  private readonly limiter: RateLimiter;
  private count = 0;

  constructor(private readonly opts: HttpClientOptions) {
    this.limiter = new RateLimiter(opts.requestsPerSecond);
  }

  get requestCount() {
    return this.count;
  }

  async raw(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const maxRetries = this.opts.maxRetries ?? 4;
    const timeoutMs = this.opts.timeoutMs ?? 25_000;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.limiter.acquire();
      if (signal?.aborted) throw new Error('Crawl interrompu');

      // Le timeout par tentative est combiné au signal d'annulation global.
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

      this.count++;
      try {
        const res = await fetch(url, {
          ...init,
          signal: combined,
          headers: { ...DEFAULT_HEADERS, ...this.opts.baseHeaders, ...(init.headers as any) },
        });

        // 429 / 5xx : le serveur nous demande de ralentir ou est en difficulté.
        if (res.status === 429 || res.status >= 500) {
          if (attempt === maxRetries) throw new HttpError(res.status, url);
          const retryAfter = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30_000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
          await sleep(backoff);
          continue;
        }

        // 4xx (hors 429) : inutile de réessayer, la requête est invalide.
        if (!res.ok) throw new HttpError(res.status, url);

        return res;
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) throw err;
        if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
        if (attempt === maxRetries) break;
        await sleep(Math.min(30_000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`Échec de la requête : ${url}`);
  }

  async getJson<T = any>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const res = await this.raw(url, { ...init, headers: { Accept: 'application/json', ...(init.headers as any) } }, signal);
    return (await res.json()) as T;
  }

  async getText(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<string> {
    const res = await this.raw(
      url,
      { ...init, headers: { Accept: 'text/html,application/xhtml+xml', ...(init.headers as any) } },
      signal,
    );
    return await res.text();
  }
}
