import { expect, test } from '@playwright/test'

test('CRM opens successfully', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', {
      name: 'Главная',
    }),
  ).toBeVisible()
})

test('client can be created', async ({ page }) => {
  await page.goto('/clients')

  await expect(
    page
      .getByRole('main')
      .getByRole('heading', {
        name: 'Клиенты',
        exact: true,
      }),
  ).toBeVisible()

  await page.getByRole('button', {
    name: 'Новый клиент',
  }).click()

  await page.getByLabel('Имя').fill(
    'E2E Test Client',
  )

  await page.getByLabel('Телефон').fill(
    '+966500000001',
  )

  await page.getByLabel('Email').fill(
    'e2e-client@example.com',
  )

  await page.getByLabel('Компания').fill(
    'E2E Company',
  )

  await page.getByRole('button', {
    name: 'Создать клиента',
  }).click()

  await expect(
    page.getByRole('link', {
      name: 'E2E Test Client',
    }),
  ).toBeVisible()

  await expect(
    page.getByText('Клиент добавлен'),
  ).toBeVisible()
})