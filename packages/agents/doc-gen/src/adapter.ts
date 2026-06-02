import type { DocGenAdapter, PlannedDocument, RenderResult } from './types';

/**
 * Dormant default render adapter. Reports not-rendered without producing a blob
 * -- the wiring default until a real DocMagic adapter is provisioned (vendor key
 * + NY form templates). Also the test double for the dispatcher guard.
 *
 * Not `async` (it does no awaiting) -- returns a resolved Promise to satisfy the
 * DocGenAdapter contract without tripping require-await.
 */
export class FixtureDocGenAdapter implements DocGenAdapter {
  render(_doc: PlannedDocument): Promise<RenderResult> {
    return Promise.resolve({ rendered: false });
  }
}
