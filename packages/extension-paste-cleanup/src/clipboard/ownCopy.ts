/**
 * Domternal own-copy contract: a copy from an editor with PasteCleanup carries
 * `data-domternal-copy="v1.<nonce>"` on the element ProseMirror marks with `data-pm-slice`
 * (or on the first copied table part inside ProseMirror's wrappers). The nonce is 16 random
 * bytes issued in this JavaScript realm and remembered for the most recent copies only, so
 * copies from other pages, applications or package instances are external content.
 */
export const OWN_COPY_ATTRIBUTE = 'data-domternal-copy';

const MAX_ISSUED = 32;
const issued: string[] = [];
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url without padding: 16 bytes become 22 characters. */
function randomNonce(): string | undefined {
  const source = (globalThis as { crypto?: Pick<Crypto, 'getRandomValues'> }).crypto;
  if (typeof source?.getRandomValues !== 'function') return undefined;
  const bytes = source.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let buffer = 0;
  let nonce = '';
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      nonce += alphabet.charAt((buffer >> bits) & 63);
    }
  }
  return nonce + alphabet.charAt((buffer << (6 - bits)) & 63);
}

/** Core copy annotator. Without a secure random source the copy stays unmarked and external. */
export function annotateOwnCopy(fragment: DocumentFragment): void {
  const first = fragment.firstChild;
  if (first?.nodeType !== 1) return;
  const nonce = randomNonce();
  if (nonce === undefined) return;
  issued.push(nonce);
  if (issued.length > MAX_ISSUED) issued.shift();
  (first as Element).setAttribute(OWN_COPY_ATTRIBUTE, `v1.${nonce}`);
}

/** Private verifier handed to normalization; pasted markup cannot add entries. */
export function isOwnCopyNonce(nonce: string): boolean {
  return issued.includes(nonce);
}
