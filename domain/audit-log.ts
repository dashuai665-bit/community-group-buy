export type AuditMetadata = Record<string, string | number | boolean | null>;

const safeMetadataKeys = new Set([
  'event',
  'reason',
  'quantity',
  'committedQuantity',
  'purchasedQuantity',
  'shortageQuantity',
  'actualTotalMinor',
  'amountMinor',
  'method',
  'status',
]);

export function projectAuditMetadata(value: string | null): AuditMetadata {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, item]) =>
          safeMetadataKeys.has(key) &&
          (item === null || ['string', 'number', 'boolean'].includes(typeof item)),
      ),
    ) as AuditMetadata;
  } catch {
    return {};
  }
}

export function auditDisplayEvent(actionType: string, metadata: AuditMetadata) {
  return typeof metadata.event === 'string' && metadata.event.trim()
    ? metadata.event
    : actionType;
}
