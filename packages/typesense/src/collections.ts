export const COMMUNICATIONS_COLLECTION = 'communications';
export const DOCUMENTS_COLLECTION = 'documents';

export const communicationsSchema = {
  name: COMMUNICATIONS_COLLECTION,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'organization_id', type: 'string', facet: true },
    { name: 'subject', type: 'string', optional: true },
    { name: 'body_preview', type: 'string', optional: true },
    { name: 'direction', type: 'string', facet: true, optional: true },
    { name: 'kind', type: 'string', facet: true },
    { name: 'vendor', type: 'string', facet: true, optional: true },
    { name: 'occurred_at', type: 'int64' },
  ] as const,
  default_sorting_field: 'occurred_at',
} as const;

export const documentsSchema = {
  name: DOCUMENTS_COLLECTION,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'organization_id', type: 'string', facet: true },
    { name: 'kind', type: 'string', facet: true },
    { name: 'status', type: 'string', facet: true },
    { name: 'filename', type: 'string', optional: true },
    { name: 'created_at', type: 'int64' },
  ] as const,
  default_sorting_field: 'created_at',
} as const;
