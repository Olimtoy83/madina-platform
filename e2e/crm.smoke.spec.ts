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

test('product creation records initial stock movement', async ({
  page,
}) => {
  const productName = 'E2E Test Product'

  await page.goto('/warehouse')

  await page.getByRole('button', {
    name: 'Добавить товар',
  }).click()

  await page
    .getByLabel('Название товара')
    .fill(productName)

  await page
    .getByLabel('Количество')
    .fill('2')

  await page
    .getByLabel('Себестоимость')
    .fill('5')

  await page
    .getByLabel('Цена продажи')
    .fill('8')

  await page.getByRole('button', {
    name: 'Сохранить товар',
  }).click()

  await expect(
    page.getByText('Товар добавлен'),
  ).toBeVisible()

  await expect(
    page.getByRole('row').filter({
      hasText: productName,
    }),
  ).toBeVisible()

  await page.goto('/warehouse/movements')

  const movementRow =
    page.getByRole('row').filter({
      hasText: productName,
    })

  await expect(movementRow).toBeVisible()

  await expect(
    movementRow.getByText('+2', {
      exact: true,
    }),
  ).toBeVisible()

  await expect(
    movementRow.getByText(
      'Начальный остаток',
      {
        exact: true,
      },
    ),
  ).toBeVisible()
})

test('completed sale updates stock and income', async ({
  page,
}) => {
  const clientName = 'E2E Sales Client'
  const productName = 'E2E Sales Product'

  await page.goto('/clients')

  await page.getByRole('button', {
    name: 'Новый клиент',
  }).click()

  await page.getByLabel('Имя').fill(
    clientName,
  )

  await page.getByRole('button', {
    name: 'Создать клиента',
  }).click()

  await expect(
    page.getByRole('link', {
      name: clientName,
    }),
  ).toBeVisible()

  await page.goto('/warehouse')

  await page.getByRole('button', {
    name: 'Добавить товар',
  }).click()

  await page
    .getByLabel('Название товара')
    .fill(productName)

  await page
    .getByLabel('Количество')
    .fill('2')

  await page
    .getByLabel('Себестоимость')
    .fill('5')

  await page
    .getByLabel('Цена продажи')
    .fill('8')

  await page.getByRole('button', {
    name: 'Сохранить товар',
  }).click()

  await expect(
    page.getByText('Товар добавлен'),
  ).toBeVisible()

  await page.goto('/sales')

  await page.getByRole('button', {
    name: 'Новая продажа',
  }).click()

  await page
    .getByLabel('Клиент')
    .selectOption({
      label: clientName,
    })

  await page
    .getByLabel('Товар')
    .selectOption({
      label: `${productName} — остаток: 2 kg`,
    })

  await page
    .getByLabel(/Количество/)
    .fill('1')

  await page
    .getByLabel('Цена за единицу')
    .fill('8')

  await page.getByRole('button', {
    name: 'Добавить товар',
  }).click()

  await page.getByRole('button', {
    name: 'Сохранить черновик',
  }).click()

  const saleRow =
    page.getByRole('row').filter({
      hasText: clientName,
    })

  await expect(saleRow).toBeVisible()

  await saleRow.getByRole('button', {
    name: 'Завершить',
  }).click()

  await expect(
    page.getByText('Продажа завершена'),
  ).toBeVisible()

  await page.goto('/warehouse')

  const productRow =
    page.getByRole('row').filter({
      hasText: productName,
    })

  await expect(productRow).toContainText(
    '1',
  )

  await page.goto('/warehouse/movements')

  const saleMovementRow =
    page.getByRole('row').filter({
      hasText: productName,
    }).filter({
      hasText: 'Продажа',
    })

  await expect(
    saleMovementRow,
  ).toBeVisible()

  await expect(
    saleMovementRow.getByText('-1', {
      exact: true,
    }),
  ).toBeVisible()

  await page.goto('/income')

  const incomeRow =
    page.getByRole('row').filter({
      hasText: 'Продажа',
    }).filter({
      hasText: '8,00 SAR',
    })

  await expect(incomeRow).toBeVisible()

  await expect(
    incomeRow.getByText('Доход', {
      exact: true,
    }),
  ).toBeVisible()

  await expect(
    incomeRow.getByText('Завершено', {
      exact: true,
    }),
  ).toBeVisible()
})