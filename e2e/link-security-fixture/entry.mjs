/**
 * The link security fixture: the public core build in a plain page, so a
 * browser suite can judge addresses with the URL policy and compare them with
 * what the browser itself reads.
 */
import { checkUrl, isValidUrl } from '@domternal/core';

/** What the browser reads from an href attribute: the resolved address and its scheme. */
function resolve(value) {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', value);
  let parsed = null;
  try {
    parsed = new URL(value, document.baseURI);
  } catch { /* An address the parser rejects resolves to nothing. */ }
  return {
    href: anchor.href,
    protocol: anchor.protocol,
    origin: parsed?.origin ?? null,
    username: parsed?.username ?? '',
    password: parsed?.password ?? '',
    parsed: parsed?.href ?? null,
  };
}

window.__linkSecurity = { ready: true, checkUrl, isValidUrl, resolve };
