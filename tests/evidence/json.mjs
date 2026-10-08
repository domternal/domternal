/**
 * JSON with the byte-level behavior of CPython's `json` module.
 *
 * The committed paste evidence was written by Python scripts: `json.dumps` with
 * `indent=2`, digests over `separators=(',', ':')` with `sort_keys=True`, and
 * reads through `json.loads(path.read_text())`. Reproducing those bytes from
 * Node needs more than `JSON.stringify`, which agrees with Python only for the
 * values the current reports happen to contain. The differences this module
 * closes:
 *
 * - Numbers. Python keeps the lexical type: `20.0` stays a float and prints as
 *   `20.0`, `1E5` prints as `100000.0`, `1e-7` as `1e-07`, and integers of any
 *   size stay exact. `JSON.parse` loses all of that. `parseJson` reads the
 *   source text of every number and returns `PyFloat` or `PyInt` wherever a
 *   plain JS number would print differently.
 * - Strings. `ensure_ascii` escapes everything outside printable ASCII,
 *   including DEL, as lowercase `\uXXXX` code units.
 * - Key order. `sort_keys` orders by code point, not by UTF-16 code unit, which
 *   matters for keys outside the Basic Multilingual Plane. Without sorting,
 *   Python keeps insertion order, which a JS object cannot do for keys that look
 *   like array indexes, so those are refused.
 *
 * Anything Node cannot reproduce exactly is refused rather than approximated:
 * non-finite numbers, unsafe integers held as plain numbers, a computed `-0`,
 * lone surrogates in UTF-8 output, `undefined`, and non-plain objects.
 */
import { createHash } from 'node:crypto';

export class EvidenceJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvidenceJsonError';
  }
}

/** Hex SHA-256 of a Buffer, Uint8Array or UTF-8 string. */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** A Python float whose value is integral, so it prints with `.0`. */
export class PyFloat {
  constructor(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EvidenceJsonError(`PyFloat needs a finite number, got ${String(value)}`);
    }
    this.value = value;
  }

  /** The Python `repr`, e.g. `20.0`. */
  toString() {
    return pythonFloatRepr(this.value);
  }
}

/** A Python int outside the range a JS number holds exactly. */
export class PyInt {
  constructor(value) {
    if (typeof value !== 'bigint') throw new EvidenceJsonError('PyInt needs a bigint');
    this.value = value;
  }

  /** The exact decimal digits. */
  toString() {
    return this.value.toString();
  }
}

/** The numeric value of a parsed number, whichever form it was returned in. */
export function numberValue(value) {
  if (typeof value === 'number') return value;
  if (value instanceof PyFloat) return value.value;
  if (value instanceof PyInt) {
    throw new EvidenceJsonError(`Integer ${value.value.toString()} is outside the exact JS range`);
  }
  throw new EvidenceJsonError(`Expected a number, got ${typeof value}`);
}

/** True for a value `parseJson` returns for a JSON number. */
export function isJsonNumber(value) {
  return typeof value === 'number' || value instanceof PyFloat || value instanceof PyInt;
}

const INDEX_KEY = /^(?:0|[1-9][0-9]*)$/;

/** JS moves such keys to the front of an object, so insertion order is lost. */
export function isArrayIndexKey(key) {
  return INDEX_KEY.test(key) && Number(key) < 4294967295;
}

const INTEGER_LEXEME = /^-?[0-9]+$/;

/**
 * Parse JSON the way `json.loads` does, keeping what Python keeps.
 *
 * Needs `JSON.parse` source text access (Node 22 or later); without it the
 * lexical type of a number is lost, so parsing fails instead.
 */
export function parseJson(input) {
  const text = typeof input === 'string' ? input : decodeUtf8(input);
  return JSON.parse(text, function reviver(key, value, context) {
    if (key === '__proto__') {
      throw new EvidenceJsonError('A "__proto__" key cannot be represented safely');
    }
    if (!Array.isArray(this) && isArrayIndexKey(key)) {
      throw new EvidenceJsonError(
        `Object key "${key}" looks like an array index; JS would reorder it, Python keeps insertion order`
      );
    }
    if (typeof value !== 'number') return value;
    const source = context?.source;
    if (typeof source !== 'string') {
      throw new EvidenceJsonError(
        'JSON.parse source text access is unavailable, so number types cannot be kept (Node 22 or later is required)'
      );
    }
    if (INTEGER_LEXEME.test(source)) {
      if (Number.isSafeInteger(value)) return value === 0 ? 0 : value;
      return new PyInt(BigInt(source));
    }
    if (!Number.isFinite(value)) {
      throw new EvidenceJsonError(`Number ${source} overflows a double; Python would write Infinity`);
    }
    return Number.isInteger(value) ? new PyFloat(value) : value;
  });
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Strict UTF-8, keeping a byte order mark as a character like Python's `utf-8`. */
export function decodeUtf8(bytes) {
  return utf8.decode(bytes);
}

/** `Path.read_text()`: strict UTF-8 plus universal newline translation. */
export function pythonReadText(bytes) {
  return decodeUtf8(bytes).replace(/\r\n?/g, '\n');
}

/** Order two strings by code point, as Python compares `str`. */
export function codePointCompare(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left.charCodeAt(index) === right.charCodeAt(index)) continue;
    const a = left.codePointAt(index);
    const b = right.codePointAt(index);
    return a < b ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

/** `repr(float)`: shortest round-trip digits with Python's layout rules. */
export function pythonFloatRepr(value) {
  if (!Number.isFinite(value)) {
    throw new EvidenceJsonError(`Non-finite number ${String(value)} has no JSON form`);
  }
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const sign = value < 0 ? '-' : '';
  const [mantissa, exponentText] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const exponent = Number(exponentText);
  const point = exponent + 1;
  if (point <= -4 || point > 16) {
    const lead = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const size = Math.abs(exponent);
    return `${sign}${lead}e${exponent < 0 ? '-' : '+'}${size < 10 ? `0${size}` : size}`;
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

const SHORT_ESCAPES = new Map([
  [0x22, '\\"'],
  [0x5c, '\\\\'],
  [0x08, '\\b'],
  [0x0c, '\\f'],
  [0x0a, '\\n'],
  [0x0d, '\\r'],
  [0x09, '\\t'],
]);

function unicodeEscape(unit) {
  return `\\u${unit.toString(16).padStart(4, '0')}`;
}

/** `json.encoder` string escaping, per UTF-16 code unit like CPython. */
export function pythonString(text, ensureAscii) {
  let out = '"';
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    const short = SHORT_ESCAPES.get(unit);
    if (short) {
      out += short;
    } else if (unit < 0x20) {
      out += unicodeEscape(unit);
    } else if (ensureAscii && unit > 0x7e) {
      out += unicodeEscape(unit);
    } else if (!ensureAscii && unit >= 0xd800 && unit <= 0xdfff) {
      const next = text.charCodeAt(index + 1);
      if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        out += text[index] + text[index + 1];
        index++;
      } else {
        throw new EvidenceJsonError('A lone surrogate cannot be written as UTF-8');
      }
    } else {
      out += text[index];
    }
  }
  return `${out}"`;
}

function pythonNumber(value) {
  if (!Number.isFinite(value)) {
    throw new EvidenceJsonError(`Non-finite number ${String(value)}: Python would write ${String(value)}, which is not JSON`);
  }
  if (Object.is(value, -0)) {
    throw new EvidenceJsonError('A computed -0 is ambiguous: Python writes 0 for an int and -0.0 for a float');
  }
  if (Number.isInteger(value)) {
    if (!Number.isSafeInteger(value)) {
      throw new EvidenceJsonError(`Integer ${String(value)} is not exact in JS; pass a PyInt`);
    }
    return String(value);
  }
  return pythonFloatRepr(value);
}

function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * `json.dumps(value, indent=..., ensure_ascii=..., sort_keys=..., separators=...)`.
 *
 * JS integers print as Python ints and other finite numbers as Python floats;
 * use `PyFloat` for an integral float and `PyInt` or a bigint for a large int.
 */
export function pythonDumps(value, { indent = null, ensureAscii = true, sortKeys = false, separators } = {}) {
  const [itemSeparator, keySeparator] = separators ?? (indent === null ? [', ', ': '] : [',', ': ']);
  const ancestors = new Set();

  function newline(level) {
    return indent === null ? '' : `\n${' '.repeat(indent * level)}`;
  }

  function encode(item, level) {
    if (item === null) return 'null';
    if (item === true) return 'true';
    if (item === false) return 'false';
    if (typeof item === 'string') return pythonString(item, ensureAscii);
    if (typeof item === 'number') return pythonNumber(item);
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof PyFloat) return pythonFloatRepr(item.value);
    if (item instanceof PyInt) return item.value.toString();
    if (typeof item !== 'object') {
      throw new EvidenceJsonError(`Cannot write a ${typeof item} as JSON`);
    }
    if (ancestors.has(item)) throw new EvidenceJsonError('Circular reference detected');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length === 0) return '[]';
        const parts = [];
        for (let index = 0; index < item.length; index++) {
          if (!(index in item)) throw new EvidenceJsonError('Sparse arrays have no JSON form');
          parts.push(encode(item[index], level + 1));
        }
        const inner = newline(level + 1);
        return `[${inner}${parts.join(itemSeparator + inner)}${newline(level)}]`;
      }
      if (!isPlainObject(item)) {
        throw new EvidenceJsonError(`Cannot write a ${item.constructor?.name ?? 'non-plain'} object as JSON`);
      }
      const keys = Object.keys(item);
      if (keys.length === 0) return '{}';
      if (sortKeys) {
        keys.sort(codePointCompare);
      } else {
        const moved = keys.find(isArrayIndexKey);
        if (moved !== undefined) {
          throw new EvidenceJsonError(`Key "${moved}" lost its insertion order in a JS object`);
        }
      }
      const inner = newline(level + 1);
      const parts = keys.map((key) => {
        if (item[key] === undefined) throw new EvidenceJsonError(`Key "${key}" is undefined`);
        return pythonString(key, ensureAscii) + keySeparator + encode(item[key], level + 1);
      });
      return `{${inner}${parts.join(itemSeparator + inner)}${newline(level)}}`;
    } finally {
      ancestors.delete(item);
    }
  }

  return encode(value, 0);
}

/** `json.dumps(value, indent=2, ensure_ascii=...) + '\n'` as UTF-8 bytes. */
export function indentedBytes(value, { ensureAscii = true } = {}) {
  return Buffer.from(`${pythonDumps(value, { indent: 2, ensureAscii })}\n`, 'utf8');
}

/** `json.dumps(value, separators=(',', ':'), ...)` as UTF-8 bytes. */
export function compactBytes(value, { ensureAscii = true, sortKeys = false } = {}) {
  return Buffer.from(pythonDumps(value, { ensureAscii, sortKeys, separators: [',', ':'] }), 'utf8');
}

/**
 * The digest input the Free scripts used for inventories and case lists:
 * `json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()`.
 */
export function canonicalBytes(value) {
  return compactBytes(value, { ensureAscii: false, sortKeys: true });
}

/** `datetime.now(timezone.utc).isoformat()` for a JS Date (millisecond precision). */
export function pythonUtcIsoformat(date) {
  const iso = date.toISOString();
  const milliseconds = iso.slice(20, 23);
  const base = iso.slice(0, 19);
  return milliseconds === '000' ? `${base}+00:00` : `${base}.${milliseconds}000+00:00`;
}

/** Escape one RFC 6901 reference token. */
export function pointerToken(key) {
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Resolve an RFC 6901 JSON pointer; undefined when it does not resolve. */
export function getPointer(document, pointer) {
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) throw new EvidenceJsonError(`Invalid JSON pointer: ${pointer}`);
  let node = document;
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, token)) return undefined;
    node = node[token];
  }
  return node;
}

function sameScalar(left, right) {
  if (left instanceof PyFloat || right instanceof PyFloat || left instanceof PyInt || right instanceof PyInt) {
    return pythonDumps(left) === pythonDumps(right);
  }
  return Object.is(left, right);
}

/**
 * Structural differences as JSON-pointer operations, including key order,
 * which decides the bytes Python writes. Empty when the values are the same.
 */
export function pointerDiff(before, after, limit = 50) {
  const operations = [];
  function walk(left, right, pointer) {
    if (operations.length >= limit) return;
    const leftObject = left !== null && typeof left === 'object' && !(left instanceof PyFloat) && !(left instanceof PyInt);
    const rightObject = right !== null && typeof right === 'object' && !(right instanceof PyFloat) && !(right instanceof PyInt);
    if (!leftObject || !rightObject || Array.isArray(left) !== Array.isArray(right)) {
      if (leftObject || rightObject || !sameScalar(left, right)) {
        operations.push({ op: 'replace', path: pointer, from: left, value: right });
      }
      return;
    }
    if (Array.isArray(left)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index++) {
        if (index >= left.length) operations.push({ op: 'add', path: `${pointer}/${index}`, value: right[index] });
        else if (index >= right.length) operations.push({ op: 'remove', path: `${pointer}/${index}` });
        else walk(left[index], right[index], `${pointer}/${index}`);
      }
      return;
    }
    for (const key of Object.keys(left)) {
      if (!Object.hasOwn(right, key)) operations.push({ op: 'remove', path: `${pointer}/${pointerToken(key)}` });
    }
    for (const key of Object.keys(right)) {
      const path = `${pointer}/${pointerToken(key)}`;
      if (!Object.hasOwn(left, key)) operations.push({ op: 'add', path, value: right[key] });
      else walk(left[key], right[key], path);
    }
    const shared = Object.keys(left).filter((key) => Object.hasOwn(right, key));
    const order = Object.keys(right).filter((key) => Object.hasOwn(left, key));
    if (shared.join('\u0000') !== order.join('\u0000')) {
      operations.push({ op: 'reorder', path: pointer, from: shared, to: order });
    }
  }
  walk(before, after, '');
  return operations.slice(0, limit);
}
