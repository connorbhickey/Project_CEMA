import { describe, expect, it } from 'vitest';

import { buildContactDedupText } from './embedding';

describe('buildContactDedupText', () => {
  it('joins name + employer + email local-part, lowercased', () => {
    expect(
      buildContactDedupText({
        name: 'Robert Smith',
        employer: 'Acme Title',
        email: 'rsmith@acme.com',
      }),
    ).toBe('robert smith acme title rsmith');
  });

  it('drops the email domain (rarely distinguishes people)', () => {
    expect(buildContactDedupText({ email: 'bob@example.com' })).toBe('bob');
  });

  it('collapses whitespace and trims each part', () => {
    expect(buildContactDedupText({ name: '  Jane   Doe  ', employer: ' LLC ' })).toBe(
      'jane doe llc',
    );
  });

  it('returns null when there is nothing identifying to embed', () => {
    expect(buildContactDedupText({})).toBeNull();
    expect(buildContactDedupText({ name: '   ', employer: null, email: null })).toBeNull();
    // phone-only contact: no name/employer/email -> null (rely on exact dedup)
    expect(buildContactDedupText({ name: null })).toBeNull();
  });
});
