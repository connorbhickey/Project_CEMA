# Renovate GitHub App — Setup Runbook

> Renovate's `renovate.json` config is already committed at the repo root. To activate automated dependency PRs, you need to install the Renovate GitHub App. This step requires browser-based OAuth and cannot be done from the CLI.

## Install the app

1. Open [github.com/apps/renovate](https://github.com/apps/renovate) in a browser.
2. Click **Install** (top right).
3. Select the `connorbhickey` org.
4. Choose **Only select repositories**.
5. Select `Project_CEMA`.
6. Click **Install**.

## First-time onboarding PR

Within ~5 minutes of install, Renovate will open a "Configure Renovate" PR. Review it — it confirms the config and proposes the first batch of dependency updates.

- Approve and merge the onboarding PR.
- Renovate will then open dependency-update PRs per the schedule in `renovate.json` (weekly for minor/patch, monthly for major).

## Configuration

`renovate.json` is already set up with:

- **Auto-merge** for security patches (daily), patches/minor (weekly), and lockfile maintenance (weekly)
- **Manual review** for major upgrades
- **Grouped updates** for: @types/\*, ESLint plugins, Vercel SDKs, LLM SDKs (Anthropic + OpenAI + Google)
- **Stability delay:** 3 days before opening update PRs (avoids broken releases)
- **Rate limits:** max 10 concurrent PRs, max 4 PRs per hour

Adjust `renovate.json` if you want different cadence.

## How to disable Renovate temporarily

```bash
# Pause Renovate without uninstalling
gh api -X POST repos/connorbhickey/Project_CEMA/dispatches -f event_type=renovate-pause
# Or simply close the Dependency Dashboard issue Renovate creates
```

## How to uninstall

Visit [github.com/organizations/connorbhickey/settings/installations](https://github.com/organizations/connorbhickey/settings/installations) → find Renovate → Uninstall.

## Troubleshooting

| Symptom                                | Cause                               | Fix                                                                                                            |
| -------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No onboarding PR appears after install | Renovate hasn't crawled yet         | Wait 15 min; check [developer.mend.io](https://developer.mend.io/github/connorbhickey/Project_CEMA) for status |
| Onboarding PR fails                    | `renovate.json` invalid             | Validate at [docs.renovatebot.com/config-validation](https://docs.renovatebot.com/config-validation/)          |
| Updates not auto-merging               | Branch protection blocks bot merges | Add `renovate[bot]` to bypass list, OR ensure all required checks pass on bot PRs                              |
| Too many PRs at once                   | `prConcurrentLimit` too high        | Lower in `renovate.json`                                                                                       |
