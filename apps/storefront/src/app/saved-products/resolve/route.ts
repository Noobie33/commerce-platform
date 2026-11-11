import { resolveInput } from '../../../lib/saved-products';
import { resolveSaved } from '../../../lib/catalog-api';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' };
export async function POST(request: Request) {
  if (new URL(request.url).search)
    return Response.json({ code: 'INVALID_SAVED_PRODUCTS' }, { status: 400, headers });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    return Response.json({ code: 'JSON_REQUIRED' }, { status: 415, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ code: 'INVALID_SAVED_PRODUCTS' }, { status: 400, headers });
  let ids: string[];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  try {
    let length = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      length += r.value.length;
      if (length > 8192) {
        await reader.cancel();
        return Response.json({ code: 'REQUEST_TOO_LARGE' }, { status: 413, headers });
      }
      chunks.push(r.value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    if (timedOut) return Response.json({ code: 'REQUEST_TIMEOUT' }, { status: 408, headers });
    ids = resolveInput(JSON.parse(new TextDecoder().decode(data)));
  } catch {
    return Response.json({ code: 'INVALID_SAVED_PRODUCTS' }, { status: 400, headers });
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  try {
    return Response.json({ items: await resolveSaved(ids) }, { headers });
  } catch {
    return Response.json({ code: 'SAVED_PRODUCTS_UNAVAILABLE' }, { status: 503, headers });
  }
}
