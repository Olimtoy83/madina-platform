import {
  deepEqual,
  equal,
} from 'node:assert/strict'
import test from 'node:test'
import type { Product } from '@madina/core'
import ExcelJS from 'exceljs'
import {
  createProductExportWorkbook,
  createProductImportTemplateWorkbook,
  parseProductImportWorkbook,
  PRODUCT_EXPORT_HEADERS,
  PRODUCT_IMPORT_HEADERS,
  PRODUCT_IMPORT_MAX_ERRORS,
  PRODUCT_IMPORT_TEMPLATE_VERSION,
  PRODUCT_IMPORT_WORKSHEET_NAME,
} from './productsWorkbook.js'

type ImportRow = readonly [
  string,
  string,
  string,
  number | string | undefined,
  number | string,
  number | string,
  string | undefined,
]

async function writeWorkbook(
  rows: readonly ImportRow[],
  configure?: (workbook: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
  worksheet.getCell('A1').value = PRODUCT_IMPORT_TEMPLATE_VERSION
  worksheet.getRow(3).values = [...PRODUCT_IMPORT_HEADERS]

  for (const row of rows) worksheet.addRow([...row])
  configure?.(workbook)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Dates',
    category: 'dates',
    quantity: 4,
    unit: 'kg',
    costPrice: 10,
    salePrice: 15,
    status: 'active',
    createdAt: new Date('2026-08-28T12:00:00.000Z'),
    updatedAt: new Date('2026-08-29T12:00:00.000Z'),
    ...overrides,
  }
}

async function openWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  )
  return workbook
}

test('product import template has the v1 marker, exact headers, and documented defaults', async () => {
  const workbook = await openWorkbook(
    await createProductImportTemplateWorkbook(),
  )
  const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)

  equal(workbook.worksheets.length, 1)
  equal(worksheet?.state, 'visible')
  equal(worksheet?.getCell('A1').value, PRODUCT_IMPORT_TEMPLATE_VERSION)
  equal(String(worksheet?.getCell('A2').value).includes('initial_quantity (0)'), true)
  equal(String(worksheet?.getCell('A2').value).includes('status (active)'), true)
  deepEqual(
    PRODUCT_IMPORT_HEADERS.map((_, index) =>
      worksheet?.getRow(3).getCell(index + 1).value,
    ),
    [...PRODUCT_IMPORT_HEADERS],
  )
  const headers = new Set<string>(PRODUCT_IMPORT_HEADERS)
  equal(headers.has('id'), false)
  equal(headers.has('quantity'), false)
  equal(headers.has('createdAt'), false)
  equal(headers.has('updatedAt'), false)
})

test('product workbook parser returns normalized valid rows and optional defaults', async () => {
  const result = await parseProductImportWorkbook(await writeWorkbook([[
    '  Dates Medjool  ', 'dates', 'kg', undefined, 10, 15, undefined,
  ]]))

  equal(result.ok, true)
  if (!result.ok) return
  deepEqual(result.rows, [{
    row: 4,
    name: 'Dates Medjool',
    category: 'dates',
    unit: 'kg',
    initialQuantity: 0,
    costPrice: 10,
    salePrice: 15,
    status: 'active',
  }])
})

test('product workbook parser rejects malformed bytes and incorrect workbook structure', async () => {
  const malformed = await parseProductImportWorkbook(Buffer.from('not a zip'))
  equal(malformed.ok, false)
  if (!malformed.ok) equal(malformed.errors[0]?.code, 'invalid_xlsx')

  const wrongVersion = await parseProductImportWorkbook(await writeWorkbook([], (workbook) => {
    const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
    if (worksheet) worksheet.getCell('A1').value = 'v0'
  }))
  equal(wrongVersion.ok, false)
  if (!wrongVersion.ok) equal(wrongVersion.errors[0]?.code, 'invalid_template_version')

  const missingWorksheet = new ExcelJS.Workbook()
  missingWorksheet.addWorksheet('Other')
  const missing = await parseProductImportWorkbook(
    Buffer.from(await missingWorksheet.xlsx.writeBuffer()),
  )
  equal(missing.ok, false)
  if (!missing.ok) equal(missing.errors[0]?.code, 'missing_worksheet')

  const unexpected = await parseProductImportWorkbook(await writeWorkbook([], (workbook) => {
    workbook.addWorksheet('Notes')
  }))
  equal(unexpected.ok, false)
  if (!unexpected.ok) equal(unexpected.errors[0]?.code, 'unexpected_worksheet')

  const hidden = await parseProductImportWorkbook(await writeWorkbook([], (workbook) => {
    const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
    if (worksheet) worksheet.state = 'hidden'
  }))
  equal(hidden.ok, false)
  if (!hidden.ok) equal(hidden.errors[0]?.code, 'hidden_worksheet')

  const externalLink = await parseProductImportWorkbook(Buffer.concat([
    await createProductImportTemplateWorkbook(),
    Buffer.from('xl/externalLinks/externalLink1.xml'),
  ]))
  equal(externalLink.ok, false)
  if (!externalLink.ok) equal(externalLink.errors[0]?.code, 'unsafe_workbook_content')

  const macroEnabled = await parseProductImportWorkbook(Buffer.concat([
    await createProductImportTemplateWorkbook(),
    Buffer.from('xl/vbaProject.bin'),
  ]))
  equal(macroEnabled.ok, false)
  if (!macroEnabled.ok) equal(macroEnabled.errors[0]?.code, 'unsafe_workbook_content')
})

test('product workbook parser rejects missing, duplicate, and unexpected headers', async () => {
  const missing = await parseProductImportWorkbook(await writeWorkbook([], (workbook) => {
    const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
    if (worksheet) worksheet.getRow(3).getCell(1).value = ''
  }))
  equal(missing.ok, false)
  if (!missing.ok) equal(missing.errors[0]?.code, 'missing_header')

  const duplicate = await parseProductImportWorkbook(await writeWorkbook([], (workbook) => {
    const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
    if (worksheet) worksheet.getRow(3).getCell(2).value = 'name'
  }))
  equal(duplicate.ok, false)
  if (!duplicate.ok) equal(duplicate.errors[0]?.code, 'duplicate_header')

  const unexpected = await parseProductImportWorkbook(await writeWorkbook([], (workbook) => {
    const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
    if (worksheet) worksheet.getRow(3).getCell(1).value = 'product_name'
  }))
  equal(unexpected.ok, false)
  if (!unexpected.ok) equal(unexpected.errors[0]?.code, 'unexpected_header')

  const excessiveColumns = await parseProductImportWorkbook(await writeWorkbook([], (workbook) => {
    const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
    if (worksheet) worksheet.getRow(3).getCell(8).value = 'unexpected'
  }))
  equal(excessiveColumns.ok, false)
  if (!excessiveColumns.ok) equal(excessiveColumns.errors[0]?.code, 'unexpected_column')
})

test('product workbook parser returns structured row errors for unsafe and invalid cells', async () => {
  const bytes = await writeWorkbook([[
    'Dates', 'unknown', 'invalid-unit', 0, 'invalid-number', 15, 'active',
  ]], (workbook) => {
    const worksheet = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)
    if (worksheet) worksheet.getCell('A4').value = { formula: '1+1', result: 'Dates' }
  })
  const result = await parseProductImportWorkbook(bytes)

  equal(result.ok, false)
  if (result.ok) return
  equal(result.errors.some((error) =>
    error.row === 4 && error.column === 'name' && error.code === 'unsafe_cell',
  ), true)

  const unsafeText = await parseProductImportWorkbook(await writeWorkbook([[
    '=not-a-formula-cell', 'dates', 'kg', 0, 10, 15, 'active',
  ]]))
  equal(unsafeText.ok, false)
  if (!unsafeText.ok) {
    equal(unsafeText.errors.some((error) =>
      error.row === 4 && error.column === 'name' && error.code === 'unsafe_text',
    ), true)
  }
})

test('product workbook parser reports enum and numeric locations without adding unresolved product rules', async () => {
  const invalid = await parseProductImportWorkbook(await writeWorkbook([[
    'Dates', 'unknown', 'invalid-unit', 0, 'invalid-number', 15, 'active',
  ]]))

  equal(invalid.ok, false)
  if (!invalid.ok) {
    equal(invalid.errors.some((error) =>
      error.row === 4 && error.column === 'category' && error.code === 'invalid_enum',
    ), true)
    equal(invalid.errors.some((error) =>
      error.row === 4 && error.column === 'unit' && error.code === 'invalid_enum',
    ), true)
    equal(invalid.errors.some((error) =>
      error.row === 4 && error.column === 'cost_price' && error.code === 'invalid_number',
    ), true)
  }

  const unresolvedDomainRules = await parseProductImportWorkbook(await writeWorkbook([[
    '', 'dates', 'kg', -1, -10, -15, 'active',
  ]]))
  equal(unresolvedDomainRules.ok, true)
})

test('product workbook parser rejects exact trimmed duplicate names but keeps case-distinct names', async () => {
  const duplicates = await parseProductImportWorkbook(await writeWorkbook([
    ['Dates', 'dates', 'kg', 0, 10, 15, 'active'],
    ['  Dates  ', 'dates', 'kg', 0, 10, 15, 'active'],
  ]))
  equal(duplicates.ok, false)
  if (!duplicates.ok) {
    equal(duplicates.errors.some((error) =>
      error.row === 5 && error.column === 'name' && error.code === 'duplicate_row',
    ), true)
  }

  const caseDistinct = await parseProductImportWorkbook(await writeWorkbook([
    ['Dates', 'dates', 'kg', 0, 10, 15, 'active'],
    ['dates', 'dates', 'kg', 0, 10, 15, 'active'],
  ]))
  equal(caseDistinct.ok, true)
})

test('product workbook parser enforces row and error bounds', async () => {
  const atLimit = await parseProductImportWorkbook(await writeWorkbook(
    Array.from({ length: 1_000 }, (_, index) => [
      `Dates ${index}`, 'dates', 'kg', 0, 10, 15, 'active',
    ] as const),
  ))
  equal(atLimit.ok, true)
  if (atLimit.ok) equal(atLimit.rows.length, 1_000)

  const tooManyRows = await parseProductImportWorkbook(await writeWorkbook(
    Array.from({ length: 1_001 }, (_, index) => [
      `Dates ${index}`, 'dates', 'kg', 0, 10, 15, 'active',
    ] as const),
  ))
  equal(tooManyRows.ok, false)
  if (!tooManyRows.ok) equal(tooManyRows.errors[0]?.code, 'too_many_rows')

  const tooManyErrors = await parseProductImportWorkbook(await writeWorkbook(
    Array.from({ length: PRODUCT_IMPORT_MAX_ERRORS + 20 }, (_, index) => [
      `Dates ${index}`, 'invalid-category', 'kg', 0, 10, 15, 'active',
    ] as const),
  ))
  equal(tooManyErrors.ok, false)
  if (!tooManyErrors.ok) {
    equal(tooManyErrors.errors.length, PRODUCT_IMPORT_MAX_ERRORS)
    equal(tooManyErrors.errors.every((error) => error.code === 'invalid_enum'), true)
  }
})

test('product XLSX export includes authoritative product fields in deterministic order and escapes formula-like text', async () => {
  const source = [
    product({ id: 'product-1', name: 'Dates', quantity: 4 }),
    product({ id: 'product-2', name: '=HYPERLINK("bad")', status: 'inactive', quantity: 0 }),
  ]
  const workbook = await openWorkbook(await createProductExportWorkbook(source))
  const worksheet = workbook.getWorksheet('Products')

  deepEqual(
    PRODUCT_EXPORT_HEADERS.map((_, index) =>
      worksheet?.getRow(1).getCell(index + 1).value,
    ),
    [...PRODUCT_EXPORT_HEADERS],
  )
  equal(worksheet?.getCell('B2').value, 'Dates')
  equal(worksheet?.getCell('D2').value, 4)
  equal(worksheet?.getCell('H3').value, 'inactive')
  equal(worksheet?.getCell('B3').value, "'=HYPERLINK(\"bad\")")
  equal(source[1]?.name, '=HYPERLINK("bad")')
})

test('product XLSX export supports an empty authoritative product set', async () => {
  const workbook = await openWorkbook(await createProductExportWorkbook([]))
  const worksheet = workbook.getWorksheet('Products')

  equal(worksheet?.rowCount, 1)
  deepEqual(
    PRODUCT_EXPORT_HEADERS.map((_, index) =>
      worksheet?.getRow(1).getCell(index + 1).value,
    ),
    [...PRODUCT_EXPORT_HEADERS],
  )
})
