import { ADSENSE_CLIENT } from '@/lib/ads';

export const dynamic = 'force-static';

// f08c47fec0942fa0 is Google's own seller id, the same for every publisher.
export function GET() {
  if (!ADSENSE_CLIENT) return new Response('Not found', { status: 404 });

  const publisher = ADSENSE_CLIENT.replace(/^ca-/, '');
  return new Response(`google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
