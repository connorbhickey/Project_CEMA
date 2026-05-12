<!--
Thank you for contributing to Project_CEMA. Please fill out the sections below.
Required sections: Summary, Changes, Test plan, Compliance checklist.
-->

## Summary

<!-- One-sentence purpose of this PR. -->

## Changes

<!-- Bullet list of what changed. -->

-
-
-

## Linked issues

<!-- "Closes #123" / "Refs #456" -->

## Test plan

<!-- Be specific. "Tested manually" is not enough. -->

- [ ] Unit tests added/updated for changed logic
- [ ] Integration tests added/updated (Playwright) if cross-package
- [ ] Agent evals added/updated (Braintrust) if agents or prompts changed
- [ ] Manual verification steps:
  1.
  2.

## Compliance checklist

<!-- All items must be checked, OR explicitly N/A with reason. -->

- [ ] No PII in logs (used `redactPii()` middleware where applicable)
- [ ] No bypass of attorney-review gate on any legal document
- [ ] TCPA opt-in respected if borrower voice/SMS touched
- [ ] Audit trail unchanged or extended — never weakened
- [ ] No secrets in committed files
- [ ] Drizzle migrations are backward-compatible (no destructive operations on existing rows)
- [ ] N/A — explain: <!-- if any unchecked, justify here -->

## Screenshots / Demos

<!-- For UI changes, attach screenshots or a Loom. -->

## Breaking changes

- [ ] None
- [ ] Yes — migration notes below

## Migration notes

<!-- If breaking changes: what action does the operator need to take? -->

## Deployment plan

- [ ] Standard preview → main → production
- [ ] Requires manual env-var update (specify):
- [ ] Requires DB migration (described above)
- [ ] Requires feature flag (name):

## Reviewer notes

<!-- Anything the reviewer should pay special attention to. -->
