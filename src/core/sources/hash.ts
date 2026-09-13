/**
 * Content hashing. WebCrypto where it exists, and a labelled non-cryptographic fallback where it does
 * not. The fallback is prefixed so nothing can mistake it for a sha256: a weak hash that looks strong is
 * worse than one that admits what it is.
 */
const encoder = new TextEncoder();

export async function contentHash(body: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    const digest = await subtle.digest('SHA-256', encoder.encode(body));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `fnv1a:${fnv1a(body)}`;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
