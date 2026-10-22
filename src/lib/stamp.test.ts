import { describe, expect, it } from 'vitest';
import { readStamp, signStamp } from './stamp';

describe('stamp', () => {
  it('round-trips and is URL-safe', async () => {
    const s = await signStamp('secret', 'endless', 1_700_000_000_000, 'abc-123_X');
    expect(s).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(await readStamp('secret', s)).toEqual({ id: 'abc-123_X', mode: 'endless', issuedMs: 1_700_000_000_000 });
  });
  it('rejects the wrong secret', async () => {
    const s = await signStamp('secret', 'campaign', 5, 'id1');
    expect(await readStamp('other', s)).toBeNull();
  });
  it('rejects an altered payload', async () => {
    const s = await signStamp('secret', 'campaign', 5, 'id1');
    const parts = s.split('.');
    expect(await readStamp('secret', [parts[0], '6', ...parts.slice(2)].join('.'))).toBeNull();
    expect(await readStamp('secret', s.replace('campaign', 'endless'))).toBeNull();
    expect(await readStamp('secret', s.replace('id1', 'id2'))).toBeNull();
  });
  it('rejects an altered signature', async () => {
    const s = await signStamp('secret', 'campaign', 5, 'id1');
    const flipped = s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
    expect(await readStamp('secret', flipped)).toBeNull();
    expect(await readStamp('secret', s + 'A')).toBeNull();
    expect(await readStamp('secret', s.slice(0, -2))).toBeNull();
  });
  it.each(['', 'garbage', '...', 'a.b.c.d', 'campaign.x.id.sig', 'campaign.-5.id.sig', '\u0000', 'é.é.é.é'])(
    'returns null for garbage %j without throwing', async (g) => {
      expect(await readStamp('secret', g)).toBeNull();
    });
  it('returns null for non-string input', async () => {
    expect(await readStamp('secret', undefined as unknown as string)).toBeNull();
  });
});
