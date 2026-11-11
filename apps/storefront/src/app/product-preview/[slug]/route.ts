import { getProduct } from '../../../lib/catalog-api';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' };
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (new URL(request.url).search)
    return Response.json({ code: 'PRODUCT_UNAVAILABLE' }, { status: 404, headers });
  try {
    const p = await getProduct((await params).slug);
    return p
      ? Response.json(p, { headers })
      : Response.json({ code: 'PRODUCT_UNAVAILABLE' }, { status: 404, headers });
  } catch {
    return Response.json({ code: 'CATALOG_UNAVAILABLE' }, { status: 503, headers });
  }
}
