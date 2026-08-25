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

test('completed purchase updates stock and expense', async ({
  page,
}) => {
  const productName = 'E2E Purchase Product'
  const supplierName = 'E2E Supplier'

  await page.goto('/warehouse')

  await page.getByRole('button', {
    name: 'Добавить товар',
  }).click()

  await page
    .getByLabel('Название товара')
    .fill(productName)

  await page
    .getByLabel('Количество')
    .fill('0')

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

  await page.goto('/purchases')

  await page.getByRole('button', {
    name: 'Добавить поступление',
  }).click()

  await page
    .getByLabel('Дата поступления')
    .fill('2026-08-25')

  await page
    .getByLabel('Поставщик')
    .fill(supplierName)

  await page
    .getByLabel('Товар')
    .selectOption({
      label: productName,
    })

  await page
    .getByLabel('Количество')
    .fill('3')

  await page
    .getByLabel('Цена закупки')
    .fill('5')

  await page.getByRole('button', {
    name: 'Создать поступление',
  }).click()

  await expect(
    page.getByText('Закупка создана'),
  ).toBeVisible()

  await page.getByRole('button', {
    name: 'Завершить поступление',
  }).click()

  await expect(
    page.getByText('Закупка завершена'),
  ).toBeVisible()

  await page.goto('/warehouse')

  const productRow =
    page.getByRole('row').filter({
      hasText: productName,
    })

  await expect(productRow).toBeVisible()

  await expect(
    productRow,
  ).toContainText('3')

  await page.goto('/warehouse/movements')

  const purchaseMovementRow =
    page.getByRole('row').filter({
      hasText: productName,
    }).filter({
      hasText: 'Поступление',
    })

  await expect(
    purchaseMovementRow,
  ).toBeVisible()

  await expect(
    purchaseMovementRow.getByText('+3', {
      exact: true,
    }),
  ).toBeVisible()

  await page.goto('/income')

  const expenseRow =
    page.getByRole('row').filter({
      hasText: 'Закупка',
    }).filter({
      hasText: '15,00 SAR',
    })

  await expect(expenseRow).toBeVisible()

  await expect(
    expenseRow.getByText('Расход', {
      exact: true,
    }),
  ).toBeVisible()

  await expect(
    expenseRow.getByText('Завершено', {
      exact: true,
    }),
  ).toBeVisible()
})

test('task can be created updated and deleted', async ({
  page,
}) => {
  const taskTitle = 'E2E Test Task'

  await page.goto('/tasks')

  await page.getByRole('button', {
    name: 'Новая задача',
  }).click()

  await page
    .getByLabel('Название')
    .fill(taskTitle)

  await page
    .getByLabel('Описание')
    .fill('E2E task description')

  await page
    .getByLabel('Приоритет')
    .selectOption('high')

  await page
    .getByLabel('Срок выполнения')
    .fill('2026-08-30')

  await page.getByRole('button', {
    name: 'Создать задачу',
  }).click()

  await expect(
    page.getByText('Задача создана'),
  ).toBeVisible()

  const taskRow =
    page.getByRole('row').filter({
      hasText: taskTitle,
    })

  await expect(taskRow).toBeVisible()

  await expect(
    taskRow.getByText('Высокий', {
      exact: true,
    }),
  ).toBeVisible()

  await taskRow
    .getByRole('combobox')
    .selectOption('in-progress')

  await expect(
    page.getByText(
      'Статус задачи изменён',
    ),
  ).toBeVisible()

  await expect(
    taskRow.getByRole('combobox'),
  ).toHaveValue('in-progress')

  await taskRow.getByRole('button', {
    name: 'Удалить',
  }).click()

  const dialog =
    page.getByRole('dialog').filter({
      has: page.getByRole('heading', {
        name: 'Удаление задачи',
        exact: true,
      }),
    })

  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', {
    name: 'Удалить задачу',
  }).click()

  await expect(
    page.getByText('Задача удалена'),
  ).toBeVisible()

  await expect(taskRow).toHaveCount(0)
})

test('modal keeps keyboard focus and restores it on close', async ({
  page,
}) => {
  await page.goto('/tasks')

  const trigger = page.getByRole('button', {
    name: 'Новая задача',
  })

  await trigger.focus()

  await expect(trigger).toBeFocused()

  await trigger.click()

  const dialog = page.getByRole('dialog', {
    name: 'Новая задача',
  })

  await expect(dialog).toBeVisible()

  const closeButton = dialog.getByRole('button', {
    name: 'Закрыть модальное окно',
  })

  await expect(closeButton).toBeFocused()

  await page.keyboard.press('Shift+Tab')

  await expect(
    dialog.getByRole('button', {
      name: 'Отмена',
    }),
  ).toBeFocused()

  await page.keyboard.press('Tab')

  await expect(closeButton).toBeFocused()

  await page.keyboard.press('Escape')

  await expect(dialog).toHaveCount(0)

  await expect(trigger).toBeFocused()
})

test('client is not published when persistence fails', async ({
  page,
}) => {
  const clientName =
    'E2E Persistence Failure Client'

  await page.goto('/clients')

  await page.getByRole('button', {
    name: 'Новый клиент',
  }).click()

  await page
    .getByLabel('Имя')
    .fill(clientName)

  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error(
        'E2E forced persistence failure',
      )
    }
  })

  await page.getByRole('button', {
    name: 'Создать клиента',
  }).click()

  await expect(
    page.getByText('Ошибка сохранения'),
  ).toBeVisible()

  await expect(
    page.getByRole('link', {
      name: clientName,
    }),
  ).toHaveCount(0)
})
