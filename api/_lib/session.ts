/**
 * Stateless, signed-cookie sessions — no user table, no session store.
 *
 * Uses only Web Crypto (`crypto.subtle`), which is available both in Vercel's Node.js function
 * runtime (Node 19+) and in Vercel's Edge Middleware runtime, so this exact file is shared
 * unmodified by `middleware.ts` (edge) and the `api/auth/*.ts` / `api/publish/*.ts` handlers
 * (node). A session token is `base64url(payload-json).base64url(hmac-sha256(payload))`; there are
 * two independent session "kinds" (owner vs presentation) so an owner cookie can never be replayed
 * as a presentation cookie or vice versa, even though both are signed with the same secret.
 */

export type SessionKind = 'owner' | 'presentation'

interface SessionPayload {
  sub: SessionKind
  iat: number
  exp: number
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const COOKIE_NAMES: Record<SessionKind, string> = {
  owner: 'owner_session',
  presentation: 'presentation_session',
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const str = atob(padded)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function createSessionToken(kind: SessionKind, secret: string): Promise<string> {
  const now = Date.now()
  const payload: SessionPayload = { sub: kind, iat: now, exp: now + SESSION_TTL_MS }
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart))
  return `${payloadPart}.${base64UrlEncode(new Uint8Array(sig))}`
}

export async function verifySessionToken(token: string | undefined | null, kind: SessionKind, secret: string): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadPart, sigPart] = parts
  try {
    const key = await hmacKey(secret)
    const ok = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sigPart), encoder.encode(payloadPart))
    if (!ok) return false
    const payload = JSON.parse(decoder.decode(base64UrlDecode(payloadPart))) as SessionPayload
    return payload.sub === kind && typeof payload.exp === 'number' && Date.now() <= payload.exp
  } catch {
    return false
  }
}

/** Constant-time string compare — used for the password/access-code checks themselves, not just
 * the HMAC (crypto.subtle.verify is already constant-time), so a slow early-exit `===` on the
 * shared secret can't leak timing information either. */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ])
  const bytesA = new Uint8Array(macA)
  const bytesB = new Uint8Array(macB)
  if (bytesA.length !== bytesB.length) return false
  let diff = 0
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i]
  return diff === 0 && a.length === b.length
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const name = part.slice(0, idx).trim()
    if (!name) continue
    out[name] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

export function serializeCookie(name: string, value: string, opts: { maxAgeSeconds?: number; clear?: boolean; secure?: boolean } = {}): string {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (opts.secure !== false) attrs.push('Secure')
  attrs.push(opts.clear ? 'Max-Age=0' : `Max-Age=${opts.maxAgeSeconds ?? 60 * 60 * 24 * 30}`)
  return attrs.join('; ')
}

/** Vercel dev / plain `localhost` serves over http — a `Secure` cookie would silently never be
 * set by the browser there, breaking local testing. Real deployments are always https. */
export function isLocalHost(host: string | undefined | null): boolean {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
}
