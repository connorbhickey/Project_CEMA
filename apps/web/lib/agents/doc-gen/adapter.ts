import { FixtureDocGenAdapter, type DocGenAdapter } from '@cema/agents-doc-gen';

// Dormant FixtureDocGenAdapter today; the one-line swap point for a real DocMagic
// adapter once a vendor key + NY form templates are provisioned.
export const docGenAdapter: DocGenAdapter = new FixtureDocGenAdapter();
