import { NextResponse } from 'next/server';
import { suggest } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * Suggestions de recherche, à la frappe.
 *
 * Route serveur plutôt que recherche côté navigateur : le catalogue fait
 * 200 000 produits et n'a rien à faire dans le navigateur. FTS5 répond en
 * quelques millisecondes, donc l'aller-retour reste imperceptible.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';

  if (q.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  return NextResponse.json(
    { suggestions: suggest(q, 4) },
    {
      // Les suggestions bougent peu d'une frappe à l'autre : un cache court
      // évite de refaire le travail pendant que l'utilisateur tape.
      headers: { 'Cache-Control': 'private, max-age=30' },
    },
  );
}
