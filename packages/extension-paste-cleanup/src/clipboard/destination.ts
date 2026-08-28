import type { NodeType, Schema } from '@domternal/pm/model';

const RASTER_TYPES = ['image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type ClipboardRasterMime = typeof RASTER_TYPES[number];

export interface ClipboardDestinationLimits {
  readonly maxMetadataLength: number;
  readonly maxMimeTypes: number;
  readonly maxFileBytes: number;
}

/** Explicit custom-node policy. Schema attributes alone do not establish insertion capability. */
export interface ClipboardImageDestinationInput {
  readonly nodeTypeName: string;
  readonly sourceAttribute: string;
  readonly inline: boolean;
  readonly allowEmbedded: boolean;
  readonly allowedMimeTypes: readonly string[];
  readonly maxFileBytes: number;
  /** Change this when a custom mapping or URL policy changes without replacing its schema. */
  readonly policyVersion: string;
}

export interface ClipboardImageDestination {
  readonly schema: Schema;
  readonly nodeType: NodeType;
  readonly nodeTypeName: string;
  readonly sourceAttribute: string;
  readonly inline: boolean;
  readonly allowEmbedded: boolean;
  readonly allowedMimeTypes: readonly ClipboardRasterMime[];
  readonly maxFileBytes: number;
  readonly policyKey: string;
}

export type ClipboardDestinationResult =
  | { readonly status: 'available'; readonly destination: ClipboardImageDestination }
  | {
      readonly status: 'unsupported';
      readonly reason: 'missing-node' | 'incompatible-schema' | 'invalid-policy' | 'policy-limit' | 'unreadable-policy';
    };

/** Exact supported MIME tokens only. Bound before case folding, with no MIME guessing. */
export function clipboardRasterMime(value: string): ClipboardRasterMime | undefined {
  if (value.length > 10) return undefined;
  const lower = value.toLowerCase();
  return RASTER_TYPES.find(type => type === lower);
}

function validatedLimits(input: ClipboardDestinationLimits): ClipboardDestinationLimits {
  const limits = {
    maxMetadataLength: input.maxMetadataLength,
    maxMimeTypes: input.maxMimeTypes,
    maxFileBytes: input.maxFileBytes,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid clipboard destination limit: ${key}`);
  }
  return Object.freeze(limits);
}

function unsupported(reason: Extract<ClipboardDestinationResult, { status: 'unsupported' }>['reason']): ClipboardDestinationResult {
  return Object.freeze({ status: 'unsupported', reason });
}

/** Pure policy normalization. It does not parse HTML, inspect a File or create document nodes. */
function createDestination(schema: Schema, input: ClipboardImageDestinationInput, limits: ClipboardDestinationLimits): ClipboardDestinationResult {
  const nodeTypeName: unknown = input.nodeTypeName;
  const sourceAttribute: unknown = input.sourceAttribute;
  const policyVersion: unknown = input.policyVersion;
  const inline: unknown = input.inline;
  const allowEmbedded: unknown = input.allowEmbedded;
  const maxFileBytes: unknown = input.maxFileBytes;
  const mimeTypes: unknown = input.allowedMimeTypes;
  for (const value of [nodeTypeName, sourceAttribute, policyVersion]) {
    if (typeof value !== 'string' || value.length === 0) return unsupported('invalid-policy');
    if (value.length > limits.maxMetadataLength) return unsupported('policy-limit');
  }
  if (typeof nodeTypeName !== 'string' || typeof sourceAttribute !== 'string' || typeof policyVersion !== 'string'
    || typeof inline !== 'boolean' || typeof allowEmbedded !== 'boolean'
    || typeof maxFileBytes !== 'number' || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0
    || !Array.isArray(mimeTypes)) return unsupported('invalid-policy');
  const mimeCount = mimeTypes.length;
  if (!Number.isSafeInteger(mimeCount) || mimeCount < 0) return unsupported('invalid-policy');
  if (mimeCount > limits.maxMimeTypes) return unsupported('policy-limit');
  const allowed = new Set<ClipboardRasterMime>();
  for (let index = 0; index < mimeCount; index++) {
    const value: unknown = mimeTypes[index];
    if (typeof value !== 'string') return unsupported('invalid-policy');
    if (value.length > limits.maxMetadataLength) return unsupported('policy-limit');
    const type = clipboardRasterMime(value);
    if (type !== undefined) allowed.add(type);
  }
  if (!Object.hasOwn(schema.nodes, nodeTypeName)) return unsupported('missing-node');
  const nodeType = schema.nodes[nodeTypeName];
  if (nodeType?.isInline !== inline
    || !Object.hasOwn(nodeType.spec.attrs ?? {}, sourceAttribute)) return unsupported('incompatible-schema');
  const allowedMimeTypes = Object.freeze([...allowed].sort());
  const boundedFileBytes = Math.min(maxFileBytes, limits.maxFileBytes);
  const policyKey = JSON.stringify([
    'clipboard-image-destination:1', nodeTypeName, sourceAttribute, inline,
    allowEmbedded, allowedMimeTypes, boundedFileBytes, policyVersion,
  ]);
  const destination: ClipboardImageDestination = Object.freeze({
    schema, nodeType, nodeTypeName, sourceAttribute, inline, allowEmbedded,
    allowedMimeTypes, maxFileBytes: boundedFileBytes, policyKey,
  });
  return Object.freeze({ status: 'available', destination });
}

export function createClipboardImageDestination(
  schema: Schema,
  input: ClipboardImageDestinationInput,
  inputLimits: ClipboardDestinationLimits,
): ClipboardDestinationResult {
  const limits = validatedLimits(inputLimits);
  try { return createDestination(schema, input, limits); }
  catch { return unsupported('unreadable-policy'); }
}

/**
 * Read a caller-identified built-in Image's live options, without discovering extensions by name.
 * The caller must identify the actual built-in extension. Custom nodes use the explicit factory.
 * Legacy maxFileSize=0 is converted to the finite capture ceiling, not a new unlimited policy.
 */
export function readBuiltinImageDestination(
  schema: Schema,
  readLiveOptions: () => unknown,
  inputLimits: ClipboardDestinationLimits,
): ClipboardDestinationResult {
  const limits = validatedLimits(inputLimits);
  try {
    const raw = readLiveOptions();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return unsupported('invalid-policy');
    const options = raw as Record<string, unknown>;
    const inline = options['inline'];
    const allowBase64 = options['allowBase64'];
    const maxFileSize = options['maxFileSize'];
    const allowedMimeTypes = options['allowedMimeTypes'];
    if (typeof inline !== 'boolean' || typeof allowBase64 !== 'boolean' || typeof maxFileSize !== 'number'
      || !Number.isSafeInteger(maxFileSize) || maxFileSize < 0 || !Array.isArray(allowedMimeTypes)) return unsupported('invalid-policy');
    return createDestination(schema, {
      nodeTypeName: 'image', sourceAttribute: 'src', policyVersion: 'builtin-image:1',
      inline, allowEmbedded: allowBase64,
      maxFileBytes: maxFileSize === 0 ? limits.maxFileBytes : maxFileSize,
      allowedMimeTypes: allowedMimeTypes as string[],
    }, limits);
  } catch { return unsupported('unreadable-policy'); }
}

/** Material equality includes schema and node identity, not only a matching serialized policy. */
export function sameClipboardImageDestination(left: ClipboardImageDestination, right: ClipboardImageDestination): boolean {
  return left.schema === right.schema && left.nodeType === right.nodeType && left.policyKey === right.policyKey;
}
