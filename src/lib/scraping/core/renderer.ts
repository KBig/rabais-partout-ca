import type { Browser, Page } from 'playwright-core';

/**
 * RENDU DE PAGE, POUR LES SITES QUI N'EN LAISSENT PAS D'AUTRE.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI C'EST LE DERNIER RECOURS
 * ----------------------------------------------------------------------------
 *
 * Presque tous les marchands publient leurs données autrement : une API de
 * listing (Best Buy, IKEA), un état embarqué dans la page (Newegg), un point
 * d'entrée ouvert par conception (Shopify), ou du JSON-LD sur chaque fiche
 * (Costco). Toutes ces voies sont plus rapides, plus stables et plus légères.
 *
 * Reste le cas de Canadian Tire : leurs pages sont entièrement construites
 * côté client, et le prix vient d'une API protégée par une clé. Je ne prends
 * pas cette clé dans leur page — franchir une barrière posée délibérément
 * n'est pas la même chose qu'utiliser un point d'entrée ouvert.
 *
 * Ce qui reste est simplement de VISITER la page, comme n'importe qui. Le
 * navigateur exécute leur propre code, dans leur propre contexte. On ne
 * détourne rien : on regarde la page qu'ils servent.
 *
 * ----------------------------------------------------------------------------
 * CE QUI LE REND SUPPORTABLE
 * ----------------------------------------------------------------------------
 *
 * Un navigateur coûte cher : mémoire, temps, fragilité au moindre remaniement
 * du site. Trois décisions limitent la facture :
 *
 *   UN SEUL NAVIGATEUR pour toute la collecte, une seule page réutilisée. Le
 *   démarrage coûte plus que la navigation.
 *
 *   ON BLOQUE CE QUI NE SERT PAS — images, polices, vidéos, mouchards. Une
 *   page de rayon charge une centaine d'images dont on n'a pas besoin : leurs
 *   URL suffisent, et elles sont dans le HTML.
 *
 *   ON PILOTE CHROME, déjà installé, plutôt que de télécharger les navigateurs
 *   de Playwright. `playwright-core` pèse quelques mégaoctets au lieu de trois
 *   cents.
 */

/** Ressources inutiles à l'extraction, et coûteuses à charger. */
const A_BLOQUER = new Set(['image', 'media', 'font', 'stylesheet']);

/** Domaines de mesure d'audience : aucun apport, du temps perdu. */
const MOUCHARDS =
  /googletagmanager|google-analytics|doubleclick|facebook\.net|hotjar|optimizely|dynatrace|adobedtm|onetrust|criteo|bazaarvoice/i;

export interface RenderOptions {
  /** Sélecteur dont l'apparition signale que le contenu utile est là. */
  attendre?: string;
  /** Faire défiler pour déclencher le chargement paresseux. */
  defiler?: boolean;
  /**
   * Ne capturer que ce fragment, au lieu du document entier.
   *
   * Une page de rayon pèse un demi-mégaoctet ; trente instantanés en font
   * quinze, gardés en mémoire pendant que Chrome travaille. C'est ce qui l'a
   * fait planter. Les cartes produit, elles, tiennent en quelques dizaines de
   * kilo-octets.
   */
  fragment?: string;
  /** Délai maximal, en millisecondes. */
  timeoutMs?: number;
}

/**
 * Un navigateur partagé, ouvert à la demande.
 *
 * Le démarrage de Chrome prend une à deux secondes : le refaire par page
 * multiplierait le coût de la collecte. On l'ouvre au premier besoin et on le
 * ferme à la fin.
 */
export class Renderer {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private count = 0;

  get requestCount() {
    return this.count;
  }

  /** Au-dela, on repart sur une page neuve : la memoire ne se libere pas seule. */
  private static readonly PAGES_AVANT_RECYCLAGE = 40;

  private async ensure(): Promise<Page> {
    if (this.page && this.count % Renderer.PAGES_AVANT_RECYCLAGE !== 0) return this.page;
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.browser) {
      this.page = await (await this.browser.newContext({
        locale: 'fr-CA',
        viewport: { width: 1440, height: 900 },
      })).newPage();
      return this.page;
    }

    // Import différé : un projet qui ne rend aucune page ne doit pas payer le
    // chargement de Playwright, ni échouer s'il n'est pas installé.
    const { chromium } = await import('playwright-core');

    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        // Chrome plantait au bout de quelques rayons : la memoire partagee
        // par defaut est trop petite pour des pages aussi lourdes.
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--js-flags=--max-old-space-size=512',
      ],
    });

    const context = await this.browser.newContext({
      locale: 'fr-CA',
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    await context.route('**/*', (route) => {
      const req = route.request();
      if (A_BLOQUER.has(req.resourceType()) || MOUCHARDS.test(req.url())) {
        return route.abort();
      }
      return route.continue();
    });

    this.page = await context.newPage();
    return this.page;
  }

  /**
   * Charge une page et renvoie son HTML, en plusieurs instantanés.
   *
   * UNE seule capture ne suffit pas sur une grille VIRTUALISÉE : le site ne
   * garde dans le document que les articles visibles, et recycle les autres.
   * Descendre puis relire donnait donc dix-huit liens et zéro prix — les
   * cartes du haut avaient déjà été effacées.
   *
   * On capture donc à chaque palier de défilement. L'appelant déduplique, ce
   * qu'il fait de toute façon.
   */
  async snapshots(url: string, opts: RenderOptions = {}): Promise<string[]> {
    const page = await this.ensure();
    this.count++;

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: opts.timeoutMs ?? 45_000,
    });

    if (opts.attendre) {
      try {
        await page.waitForSelector(opts.attendre, { timeout: 20_000 });
      } catch {
        // Le sélecteur peut manquer légitimement — un rayon vide, une page
        // remaniée. On rend ce qu'on a plutôt que d'échouer.
      }
    }

    const capturer = async (): Promise<string> => {
      if (!opts.fragment) return page.content();
      try {
        return await page.evaluate(
          (sel) => [...document.querySelectorAll(sel)].map((e) => e.outerHTML).join(''),
          opts.fragment,
        );
      } catch {
        return '';
      }
    };

    const vues: string[] = [await capturer()];
    if (!opts.defiler) return vues;

    // On descend par paliers courts, en capturant à chaque arrêt. On s'arrête
    // quand la page cesse de grandir : tout est chargé.
    let hauteur = 0;
    for (let i = 0; i < 30; i++) {
      const h = await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.85);
        return document.body.scrollHeight;
      });
      await page.waitForTimeout(650);
      vues.push(await capturer());

      const enBas = await page.evaluate(
        () => window.scrollY + window.innerHeight >= document.body.scrollHeight - 50,
      );
      if (enBas && h === hauteur) break;
      hauteur = h;
    }

    return vues;
  }

  /** Une seule capture, pour les pages qui n'ont rien de paresseux. */
  async html(url: string, opts: RenderOptions = {}): Promise<string> {
    const vues = await this.snapshots(url, { ...opts, defiler: false });
    return vues[0] ?? '';
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }
}

/** Un rendu par collecte : le navigateur est ouvert et fermé une seule fois. */
let partage: Renderer | null = null;

export function renderer(): Renderer {
  return (partage ??= new Renderer());
}

export async function closeRenderer(): Promise<void> {
  await partage?.close();
  partage = null;
}
