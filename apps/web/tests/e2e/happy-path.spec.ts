import { expect, test } from '@playwright/test';

// Requires E2E_USER_EMAIL / E2E_USER_PASSWORD env vars set against a real
// Clerk dev-instance account. Without them the test is skipped — CI's
// Playwright workflow is label-gated so this never blocks the main suite.
const skip = !process.env.E2E_USER_EMAIL;
test.skip(skip, 'Skipping — set E2E_USER_EMAIL + E2E_USER_PASSWORD to run');

// ---------------------------------------------------------------------------
// Helper: find the <input> or <select> inside a Field wrapper identified by
// its label text. DealForm renders <Label>text</Label><Input> as siblings
// with no htmlFor, so getByLabel() won't work — we use the wrapper div.
// ---------------------------------------------------------------------------
function fieldInput(page: import('@playwright/test').Page, labelText: string | RegExp) {
  return page
    .locator('div.space-y-1', { has: page.locator('label', { hasText: labelText }) })
    .locator('input, select')
    .first();
}

test('user can sign in and create a Refi-CEMA deal', async ({ page }) => {
  // ── 1. Sign in via Clerk hosted UI ──────────────────────────────────────
  await page.goto('/sign-in/');
  await page.getByLabel(/email address/i).fill(process.env.E2E_USER_EMAIL!);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByLabel(/password/i).fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole('button', { name: /continue/i }).click();

  // Clerk redirects to /dashboard after successful sign-in
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

  // ── 2. Navigate to Deals list ────────────────────────────────────────────
  await page.getByRole('link', { name: /^deals$/i }).click();
  await expect(page).toHaveURL(/\/deals$/);

  // ── 3. Open the New Deal form ────────────────────────────────────────────
  await page.getByRole('link', { name: /new deal/i }).click();
  await expect(page).toHaveURL(/\/deals\/new$/);

  // ── 4. Fill the form using Field-wrapper locators ────────────────────────
  // CEMA type stays at default "refi_cema"
  await fieldInput(page, /street address/i).fill('123 Main St');
  await fieldInput(page, /^city$/i).fill('Brooklyn');
  await fieldInput(page, /county/i).fill('Kings');
  await fieldInput(page, /^zip$/i).fill('11201');
  await fieldInput(page, /upb/i).fill('420000');
  await fieldInput(page, /new principal/i).fill('700000');

  // ── 5. Submit ────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /create deal/i }).click();

  // ── 6. Assert redirect to deal detail page ───────────────────────────────
  await expect(page).toHaveURL(/\/deals\/[a-f0-9-]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /refi cema/i })).toBeVisible();
});
