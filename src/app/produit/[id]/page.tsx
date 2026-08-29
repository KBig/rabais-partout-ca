import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getProduct,
  priceHistory,
  competingOffers,
  betterAlternatives,
  comparables,
  categoryRank,
  topDeals,
  manufacturerReference,
} from '@/lib/db/queries';
import { leadSentence } from '@/lib/specs';
import { analyzeComponents } from '@/lib/quality/components';
import { ComponentAnalysis } from '@/components/ComponentAnalysis';
import { categoryName } from '@/lib/categories';
import { ScoreBadge, ConfidenceLabel } from '@/components/ScoreBadge';
import { DiscountBadge } from '@/components/DiscountBadge';
import { PriceChart } from '@/components/PriceChart';
import { DealGrid, retourSur } from '@/components/DealCard';
import { ProductImage } from '@/components/ProductImage';
import { BackButton } from '@/components/BackButton';
import {
  money,
  num,
  pct,
  CONDITION_LABEL,
  AVAILABILITY_LABEL,
  scoreTone,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const product = getProduct(Number(id));
  if (!product) notFound();

  // D'ou vient-on ? Le listing transmet son adresse complete, filtres compris,
  // pour que le fil d'Ariane y ramene au lieu de renvoyer au rayon nu.
  const retour = retourSur(sp.de);

  const history = priceHistory(product.id);
  const competitors = competingOffers(product);
  const alternatives = betterAlternatives(product);
  const face = comparables(product);
  const pdsf = manufacturerReference(product.id);

  // La fiche montre la qualite que le SCORE a utilisee, pas celle de l'unite.
  //
  // Une unite boite ouverte porte ses propres 14 avis alors que le meme modele
  // en neuf en compte 44 : le moteur retient le plus grand echantillon, ce qui
  // est le bon choix. Afficher les 14 a cote d'une raison citant 44 donnait
  // trois nombres differents sur le meme ecran, tous exacts, et l'impression
  // d'un systeme incoherent.
  const noteUtilisee = product.qualityRating ?? product.rating;
  const avisUtilises = product.qualityCount ?? product.ratingCount;
  const qualiteHeritee =
    product.qualityCount !== null &&
    product.ratingCount !== null &&
    product.qualityCount !== product.ratingCount;
  const rang = categoryRank(product);
  const composantes = analyzeComponents(
    product.title,
    product.description,
    product.categorySlug,
  );
  const accroche = leadSentence(product.description);
  const similar = product.categorySlug
    ? topDeals({ category: product.categorySlug, limit: 10 }).filter((d) => d.id !== product.id)
    : [];

  const tone = scoreTone(product.score);
  const recommendPct =
    product.recommendTotal && product.recommendYes !== null
      ? product.recommendYes / product.recommendTotal
      : null;

  return (
    <div className="space-y-12">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
        <BackButton />
        <span className="text-line">|</span>
        <Link href="/" className="hover:text-muted">
          Découvrir
        </Link>
        <span>/</span>
        {product.categorySlug && (
          <>
            <Link
              href={retour ?? `/categories/${product.categorySlug}`}
              className="hover:text-muted"
            >
              {categoryName(product.categorySlug)}
            </Link>
            <span>/</span>
          </>
        )}
        <span className="truncate text-muted">{product.brand ?? product.storeName}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="relative grid min-h-[340px] place-items-center overflow-hidden rounded-card border border-line bg-white/[0.03] p-6">
          <ProductImage
            src={product.imageUrl}
            targetWidth={1500}
            // Image principale de la page : elle doit charger immédiatement,
            // pas attendre le défilement.
            priority
            alt={product.title}
            brand={product.brand}
            className="mx-auto max-h-[380px] w-full object-contain"
          />
        </div>

        <div className="min-w-0 space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
                style={{ background: product.storeColor ?? '#1e2637' }}
              >
                {product.storeName}
              </span>
              {product.condition !== 'new' && (
                <span className="rounded-md bg-warm/15 px-2 py-0.5 text-[11px] font-semibold text-warm">
                  {CONDITION_LABEL[product.condition] ?? product.condition}
                </span>
              )}
              {product.isLowestEver === 1 && (
                <span className="rounded-md bg-brand px-2 py-0.5 text-[11px] font-bold text-ink">
                  Plus bas jamais vu
                </span>
              )}
            </div>

            {product.brand && (
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-faint">
                {product.brand}
              </p>
            )}
            <h1 className="mt-1 text-xl font-bold leading-snug sm:text-2xl">{product.title}</h1>
            {product.model && (
              <p className="mt-1.5 text-xs text-faint">Modèle {product.model}</p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <span className="tnum text-3xl font-bold">{money(product.price)}</span>
            {product.median && product.median > product.price * 1.02 && (
              <span className="tnum text-base text-faint line-through">
                {money(product.median)}
              </span>
            )}
            {/*
              Best Buy affiche sur son site un prix INCLUANT les écofrais
              provinciaux, que son API ne renvoie pas (le champ `ehf` vaut 0).
              L'écart constaté — 824,99 $ chez nous contre 833,49 $ chez eux —
              venait entièrement de là. On le signale plutôt que de laisser
              croire à une donnée périmée.
            */}
            {product.dropVsMedian && product.dropVsMedian >= 0.03 ? (
              <span className="flex items-center gap-2">
                <DiscountBadge fraction={product.dropVsMedian} verified size="md" />
                <span className="text-xs text-muted">sous le prix habituel</span>
              </span>
            ) : product.listPrice && product.listPrice > product.price ? (
              <DiscountBadge
                fraction={(product.listPrice - product.price) / product.listPrice}
                verified={false}
                size="md"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-4 rounded-card border border-line bg-surface p-4">
            <ScoreBadge score={product.score} confidence={product.confidence} size="lg" />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${tone.text}`}>
                {tone.label} — {Math.round(product.score)} sur 100
              </p>
              <ConfidenceLabel confidence={product.confidence} />
              <p className="mt-1 text-[11px] text-faint">
                {product.daysOfHistory >= 1
                  ? `${Math.round(product.daysOfHistory)} jour${product.daysOfHistory >= 2 ? 's' : ''} d'historique`
                  : 'Historique commencé aujourd’hui'}
              </p>
            </div>
          </div>

          {product.reasons.length > 0 && (
            <ul className="space-y-1.5">
              {product.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 text-sm text-muted">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand" />
                  {r}
                </li>
              ))}
            </ul>
          )}

          {/*
            Tant qu'une disponibilite n'a pas ete REELLEMENT observee, on
            n'affiche rien. Une affirmation fausse est indistinguable d'une
            vraie pour le lecteur : mieux vaut le silence.
          */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {AVAILABILITY_LABEL[product.availability] && (
            <span className="flex items-center gap-1.5 text-muted">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-3.5 w-3.5 text-faint"
                aria-hidden
              >
                <path d="M3 9h18M5 9V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
              </svg>
              {AVAILABILITY_LABEL[product.availability]}
            </span>
            )}

            {product.marketplace === 1 && (
              <span className="text-warm">
                Vendu par {product.sellerName ?? 'un vendeur tiers'} — retours et service
                après-vente selon ses propres conditions
              </span>
            )}
          </div>

          <p className="text-[11px] text-faint">
            Prix affiché par le marchand, écofrais provinciaux en sus le cas échéant.
          </p>

          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Voir chez {product.storeName}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
              <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      {accroche && (
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            Ce qu&apos;il faut savoir
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">{accroche}</p>
        </section>
      )}

      {composantes.length > 0 && <ComponentAnalysis verdicts={composantes} />}

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Historique de prix</h2>
        <PriceChart
          points={history}
          currentPrice={product.price}
          median={product.median}
          height={230}
        />

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Prix médian (90 j)" value={money(product.median)} />
          <Fact label="Plus bas observé" value={money(product.minEver)} accent />
          <Fact label="Plus haut observé" value={money(product.maxEver)} />
          <Fact
            label="Prix régulier affiché"
            value={product.listPrice ? money(product.listPrice) : 'aucun'}
          />
        </dl>

        {/*
          Le prix du fabricant est une ANCRE, pas un point d'historique : il ne
          rejoint pas la courbe, qui ne montre que ce que nous avons releve
          nous-memes. Le confondre reviendrait a inventer une observation.
        */}
        {pdsf && (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-card border border-line bg-surface px-4 py-3">
            <span className="text-[11px] uppercase tracking-wide text-faint">
              Prix officiel du fabricant
            </span>
            <span className="tnum text-base font-semibold text-text">{money(pdsf.price)}</span>
            {pdsf.price > product.price && (
              <span className="tnum text-xs font-semibold text-brand">
                {Math.round(((pdsf.price - product.price) / pdsf.price) * 100)} % en dessous
              </span>
            )}
            {pdsf.sources[0] && (
              <a
                href={pdsf.sources[0]}
                target="_blank"
                rel="noreferrer nofollow"
                className="text-[11px] text-muted underline decoration-line underline-offset-2 hover:text-text"
              >
                voir la fiche constructeur
              </a>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Qualité du produit</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact
            label="Note moyenne"
            value={noteUtilisee ? `${noteUtilisee.toFixed(2)} / 5` : 'non noté'}
          />
          <Fact label="Nombre d'avis" value={num(avisUtilises)} />
          <Fact
            label="Le recommandent"
            value={recommendPct !== null ? pct(recommendPct) : 'inconnu'}
            accent={recommendPct !== null && recommendPct > 0.9}
          />
        </div>
        {qualiteHeritee && (
          <p className="mt-2 text-[11px] text-faint">
            Ces avis portent sur le même modèle, toutes unités confondues
            {product.ratingCount ? ` — cette unité-ci en compte ${num(product.ratingCount)}` : ''}.
            Le plus grand échantillon est le plus fiable.
          </p>
        )}

        {product.recommendTotal ? (
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-faint">
            La qualité est évaluée par la borne inférieure de Wilson sur{' '}
            {num(product.recommendTotal)} réponses. Cette méthode pénalise automatiquement les
            petits échantillons : « 5 sur 5 avec 2 avis » vaut moins que « 4,6 sur 5 avec 2 000
            avis », sans qu&apos;aucune règle arbitraire n&apos;ait à être écrite.
          </p>
        ) : (
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-faint">
            {/*
              Deux choses differentes, longtemps confondues ici : la NOTE et la
              RECOMMANDATION. Le marchand publie souvent l'une sans l'autre, et
              ce texte annoncait « aucun avis publie » juste a cote d'un
              compteur affichant dix avis.
            */}
            {product.ratingCount
              ? `Ce produit porte ${num(product.ratingCount)} avis, mais le marchand ne publie pas le détail « le recommande / ne le recommande pas ». La borne de Wilson a besoin de ce décompte : sans lui, la qualité repose sur la seule note moyenne, et le score en tient compte.`
              : 'Aucun avis publié pour cet article. Sans eux, la qualité reste inconnue — et le score en tient compte plutôt que de supposer.'}
          </p>
        )}
      </section>

      {competitors.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold tracking-tight">
            Le même modèle ailleurs
          </h2>
          <p className="mb-3 text-sm text-muted">
            Rapproché par numéro de modèle {product.model}.
          </p>
          <DealGrid deals={competitors} />
        </section>
      )}

      {product.reviews.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold tracking-tight">Ce qu&apos;en disent les acheteurs</h2>
          <p className="mb-3 text-sm text-muted">
            Un avis favorable et un avis critique, choisis sur leur utilite votee par les
            autres acheteurs — pas sur leur date. Ce qu&apos;on cherche avant d&apos;acheter,
            c&apos;est aussi ce qui cloche.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {product.reviews.map((av, i) => (
              <blockquote
                key={i}
                className="rounded-card border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`tnum rounded px-1.5 py-0.5 text-xs font-bold ${
                      av.rating >= 4 ? 'bg-brand/15 text-brand' : 'bg-hot/15 text-hot'
                    }`}
                  >
                    {av.rating}/5
                  </span>
                  {av.verified && (
                    <span className="text-[10px] uppercase tracking-wide text-faint">
                      Achat verifie
                    </span>
                  )}
                  {av.helpful > 0 && (
                    <span className="text-[10px] text-faint">
                      {av.helpful} personne{av.helpful > 1 ? 's' : ''} l&apos;ont trouve utile
                    </span>
                  )}
                </div>

                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {av.comment.length > 320 ? `${av.comment.slice(0, 320)}\u2026` : av.comment}
                </p>

                <footer className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                  {av.author && <span>{av.author}</span>}
                  {av.date && <span>{av.date.slice(0, 10)}</span>}
                  {av.incentivized && (
                    // Les avis obtenus contre un avantage sont statistiquement
                    // plus indulgents : le lecteur merite de le savoir.
                    <span className="text-warm">Avis obtenu en echange d&apos;un avantage</span>
                  )}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      )}

      {face.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold tracking-tight">
            Combien coûte au moins aussi bon ?
          </h2>
          <p className="mb-3 text-sm text-muted">
            Combien coûte quelque chose d&apos;<strong className="text-text">au moins aussi bon</strong> ?
            Ces articles sont aussi bien notés ou mieux, à caractéristiques équivalentes,
            du moins cher au plus cher.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Produit</th>
                  <th className="py-2 pr-3 font-medium">Prix</th>
                  <th className="py-2 pr-3 font-medium">Qualité</th>
                  <th className="py-2 font-medium">Le recommandent</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line-soft bg-brand/5">
                  <td className="py-2.5 pr-3">
                    <span className="font-semibold text-brand">Celui-ci</span>
                  </td>
                  <td className="tnum py-2.5 pr-3 font-semibold">{money(product.price)}</td>
                  <td className="tnum py-2.5 pr-3">
                    {noteUtilisee ? `${noteUtilisee.toFixed(1)}/5` : '—'}
                  </td>
                  <td className="py-2.5 text-xs text-muted">
                    {product.recommendTotal
                      ? `${Math.round(((product.recommendYes ?? 0) / product.recommendTotal) * 100)} %`
                      : '\u2014'}
                  </td>
                </tr>
                {face.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft">
                    <td className="py-2.5 pr-3">
                      <Link href={`/produit/${c.id}`} className="text-muted hover:text-brand">
                        {c.title.slice(0, 52)}
                      </Link>
                    </td>
                    <td className="tnum py-2.5 pr-3">
                      {money(c.price)}
                      {c.price < product.price && (
                        <span className="ml-1 text-[10px] text-brand">
                          &minus;{money(product.price - c.price)}
                        </span>
                      )}
                    </td>
                    <td className="tnum py-2.5 pr-3">
                      <span
                        className={
                          (c.qualityRating ?? c.rating ?? 0) > (noteUtilisee ?? 0)
                            ? 'font-semibold text-brand'
                            : ''
                        }
                      >
                        {c.qualityRating ?? c.rating
                          ? `${(c.qualityRating ?? c.rating)!.toFixed(1)}/5`
                          : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 text-xs text-muted">
                      {/*
                        Sans donnee de recommandation, on affiche un tiret. Le
                        repli precedent reaffichait la NOTE, deja presente dans
                        la colonne d'a cote : deux colonnes montraient « 4,7/5 »
                        comme si c'etaient deux mesures differentes.
                      */}
                      {c.recommendTotal
                        ? `${Math.round(((c.recommendYes ?? 0) / c.recommendTotal) * 100)} %`
                        : '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {rang && (
        <section>
          <h2 className="mb-1 text-lg font-semibold tracking-tight">Classement</h2>
          <p className="mb-3 text-sm text-muted">
            <span className="tnum font-semibold text-text">
              {rang.rank}
              <sup>{rang.rank === 1 ? 'er' : 'e'}</sup>
            </span>{' '}
            sur {num(rang.total)} produits évalués en {rang.categoryName},{' '}
            <strong className="text-text">par qualité</strong> — d&apos;après les avis
            clients, indépendamment du prix et du rabais.
            {rang.rank <= 3
              ? ' Il fait partie des mieux notés de sa catégorie.'
              : ' Voici les mieux notés, pour situer.'}
          </p>
          <ol className="space-y-1.5">
            {rang.leaders.map((l, i) => (
              <li key={l.id} className="flex items-baseline gap-3 text-sm">
                <span className="tnum w-5 shrink-0 text-faint">{i + 1}.</span>
                <Link
                  href={`/produit/${l.id}`}
                  className="min-w-0 flex-1 truncate text-muted transition-colors hover:text-brand"
                >
                  {l.title}
                </Link>
                <span className="tnum shrink-0 text-xs text-faint">{money(l.price)}</span>
                <span
                  className="tnum w-8 shrink-0 text-right text-xs font-semibold text-text"
                  title="Indice de qualité sur 100, calculé sur les avis clients"
                >
                  {Math.round(l.score)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {alternatives.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold tracking-tight">
            Mieux notés, dans la même gamme
          </h2>
          <p className="mb-3 text-sm text-muted">
            Produits équivalents (même format, mêmes caractéristiques clés) dont les
            acheteurs sont plus satisfaits.
          </p>
          <DealGrid deals={alternatives} />
        </section>
      )}

      {similar.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            Autres bons deals en {categoryName(product.categorySlug)}
          </h2>
          <DealGrid deals={similar} />
        </section>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`tnum mt-1 text-base font-semibold ${accent ? 'text-brand' : 'text-text'}`}>
        {value}
      </dd>
    </div>
  );
}
