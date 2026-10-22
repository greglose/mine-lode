// Signed "game started" stamp: mode.issuedMs.id.signature, all URL-safe text. Web Crypto only.
import type { Mode } from './session';
import { isMode } from './scores';

const enc = new TextEncoder();
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DIGITS = /^[0-9]{1,16}$/;
const SIG = /^[A-Za-z0-9_-]+$/;

const b64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function sign(secret: string, payload: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(payload))));
}

function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function signStamp(secret: string, mode: Mode, nowMs: number, id: string): Promise<string> {
  if (!ID.test(id)) throw new Error('stamp id must be URL-safe text');
  const payload = `${mode}.${Math.floor(nowMs)}.${id}`;
  return `${payload}.${await sign(secret, payload)}`;
}

export async function readStamp(secret: string, stamp: string): Promise<{ id: string; mode: Mode; issuedMs: number } | null> {
  try {
    if (typeof stamp !== 'string') return null;
    const parts = stamp.split('.');
    if (parts.length !== 4) return null;
    const [mode, issued, id, sig] = parts;
    if (!isMode(mode) || !DIGITS.test(issued) || !ID.test(id) || !SIG.test(sig)) return null;
    const expected = await sign(secret, `${mode}.${issued}.${id}`);
    return sameText(sig, expected) ? { id, mode, issuedMs: Number(issued) } : null;
  } catch {
    return null;
  }
}
