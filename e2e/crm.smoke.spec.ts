import { expect, test } from '@playwright/test'

test('CRM opens successfully', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', {
      name: 'Главная',
    }),
  ).toBeVisible()
})