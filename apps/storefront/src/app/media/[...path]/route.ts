import { mediaTarget, apiOrigin } from '../../../lib/store-query';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const target = mediaTarget((await params).path);
  if (!target || new URL(request.url).search) return new Response(null, { status: 404 });
  const range = request.headers.get('range');
  if (
    range &&
    (!target.range || range.length > 80 || !/^bytes=([0-9]+-[0-9]*|-[0-9]+)$/.test(range))
  )
    return new Response(null, { status: 416 });
  let r: Response;
  try {
    r = await fetch(apiOrigin(process.env.STORE_API_ORIGIN) + target.path, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      headers: {
        Accept: target.type,
        'Accept-Encoding': 'identity',
        ...(range ? { Range: range } : {}),
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (![200, 206].includes(r.status))
    return new Response(null, {
      status: r.status === 416 ? 416 : r.status === 404 ? 404 : 503,
      headers: {
        'Cache-Control': 'no-store',
        ...(r.status === 416 && /^bytes \*\/[0-9]+$/.test(r.headers.get('content-range') ?? '')
          ? { 'Content-Range': r.headers.get('content-range')! }
          : {}),
      },
    });
  const length = Number(r.headers.get('content-length'));
  if (
    !r.body ||
    r.headers.get('content-type') !== target.type ||
    r.headers.get('content-encoding') ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > target.max
  ) {
    await r.body?.cancel();
    return new Response(null, { status: 502 });
  }
  const headers = new Headers({
    'Content-Type': target.type,
    'Content-Length': String(length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Accept-Ranges': target.range ? 'bytes' : 'none',
  });
  if (r.status === 206) {
    const cr = r.headers.get('content-range');
    if (!target.range || !cr || !/^bytes [0-9]+-[0-9]+\/[0-9]+$/.test(cr)) {
      await r.body.cancel();
      return new Response(null, { status: 502 });
    }
    headers.set('Content-Range', cr);
  }
  const reader = r.body.getReader();
  let received = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (received !== length) throw Error('Incomplete media');
          controller.close();
          return;
        }
        received += value.length;
        if (received > length || received > target.max) throw Error('Oversized media');
        controller.enqueue(value);
      } catch {
        await reader.cancel().catch(() => {});
        controller.error(Error('Media unavailable'));
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {});
    },
  });
  return new Response(body, { status: r.status, headers });
}
