# Signed Commits — Setup Runbook

> All commits to `Project_CEMA` should be SSH-signed. This runbook documents the existing setup and what new engineers need to do.

## Current state (2026-05-12)

A signing-only SSH key has been generated and git is configured to use it:

- **Private key:** `~/.ssh/id_ed25519_signing` (passphrase-less; signing-only, no auth)
- **Public key:** `~/.ssh/id_ed25519_signing.pub`
- **Allowed signers file:** `~/.ssh/allowed_signers` (maps `conlaxer13@gmail.com` to the signing key for local verification)
- **Git config (global):**
  - `gpg.format = ssh`
  - `user.signingkey = ~/.ssh/id_ed25519_signing.pub`
  - `commit.gpgsign = true`
  - `tag.gpgsign = true`
  - `gpg.ssh.allowedSignersFile = ~/.ssh/allowed_signers`

Verified working: a test commit produced `G` (good signature) via `git log --pretty="%G?"`.

## What still needs to happen

The public signing key must be uploaded to GitHub before commit signatures show as "Verified" in the GitHub UI. The default `gh` CLI auth scope does NOT include `admin:ssh_signing_key`. Two options:

### Option A — refresh `gh` auth scope, then add via CLI

```bash
gh auth refresh -h github.com -s admin:ssh_signing_key
gh ssh-key add ~/.ssh/id_ed25519_signing.pub --type signing --title "Project_CEMA signing key"
```

### Option B — upload via GitHub web UI (no scope changes)

1. Open https://github.com/settings/ssh/new
2. **Title:** `Project_CEMA signing key`
3. **Key type:** **Signing Key** (NOT Authentication Key — important)
4. **Key:** Paste the contents of `~/.ssh/id_ed25519_signing.pub`. You can copy it with:
   ```bash
   cat ~/.ssh/id_ed25519_signing.pub
   ```

After either option, GitHub will show all future commits as "Verified" with the signing key fingerprint.

## After the public key is uploaded — enable `required_signatures`

Once new commits show as "Verified" in GitHub, signature enforcement *would* be enabled on `main` via:

```bash
gh api -X POST repos/connorbhickey/Project_CEMA/branches/main/protection/required_signatures
```

**HOWEVER:** GitHub gates `required_signatures` on private repos behind a **paid plan**. The `connorbhickey` org is currently on the **Free** plan, which returns:

```
HTTP 403: Upgrade to GitHub Pro or make this repository public to enable this feature.
```

### Options

1. **Upgrade the org to GitHub Team plan** ($4/user/month — [github.com/organizations/connorbhickey/billing/plans](https://github.com/organizations/connorbhickey/billing/plans)). Unlocks `required_signatures` plus CODEOWNERS enforcement on private repos, environment-protected deployments, etc. **Recommended for production-bound projects.**
2. **Accept enforcement via PR review process** (free). Signing still works locally; the PR template + CODEOWNERS approval acts as social enforcement. Acceptable while solo.
3. **Make the repo public** — not acceptable for proprietary mortgage software with NDAs.

**Do not enable `required_signatures` (after upgrade) until every active contributor has their public signing key uploaded to GitHub** — it will block all their pushes if the verifying side can't recognize the signature.

## New-engineer onboarding

A new engineer (or new machine) must:

1. Generate their own signing key:
   ```bash
   ssh-keygen -t ed25519 -C "<your-email> Project_CEMA signing" -f ~/.ssh/id_ed25519_signing -N ""
   ```
2. Configure git globally (same as above section).
3. Upload the public key to their GitHub via Option A or Option B.
4. Add themselves to the project's `allowed_signers` file:
   ```bash
   echo "<your-email> $(awk '{print $1, $2}' ~/.ssh/id_ed25519_signing.pub)" >> ~/.ssh/allowed_signers
   ```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `git log %G?` shows `N` instead of `G` | Local repo config overrides global | `git config --local --unset commit.gpgsign` |
| GitHub shows "Unverified" but local signing works | Public key not yet uploaded to GitHub (or uploaded as Auth key, not Signing key) | Re-upload as **Signing Key** type via web UI |
| `error: gpg failed to sign the data` | Wrong key path or permissions | Ensure private key is `chmod 600` and path matches `user.signingkey` |
| `gh ssh-key add` returns 404 | Token lacks `admin:ssh_signing_key` scope | `gh auth refresh -h github.com -s admin:ssh_signing_key` |
