// Helpers shared by the Pages Functions. The leading underscore keeps this file from becoming a route.

export const json = (data: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Cloudflare Turnstile siteverify. remoteip is optional but tightens the check. */
export async function verifyTurnstile(secret: string, token: string, request: Request): Promise<boolean> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: request.headers.get('CF-Connecting-IP') ?? '' }),
  });
  const verify = (await res.json()) as { success?: boolean };
  return verify.success === true;
}
