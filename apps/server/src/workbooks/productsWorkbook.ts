import type { ProductWorkbookRowError } from '@madina/api'
import type { Product } from '@madina/core'
import ExcelJS from 'exceljs'

export const PRODUCT_IMPORT_TEMPLATE_VERSION =
  'madina-products-import-v1'
export const PRODUCT_IMPORT_WORKSHEET_NAME = 'Products Import v1'
export const PRODUCT_WORKBOOK_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PRODUCT_IMPORT_MAX_BYTES = 10 * 1_024 * 1_024
export const PRODUCT_IMPORT_MAX_UNCOMPRESSED_BYTES = 50 * 1_024 * 1_024
export const PRODUCT_IMPORT_MAX_ROWS = 1_000
export const PRODUCT_IMPORT_MAX_ERRORS = 100
export const PRODUCT_IMPORT_MAX_ZIP_ENTRIES = 100

export const PRODUCT_IMPORT_HEADERS = [
  'name',
  'category',
  'unit',
  'initial_quantity',
  'cost_price',
  'sale_price',
  'status',
] as const

export const PRODUCT_EXPORT_HEADERS = [
  'id',
  'name',
  'category',
  'quantity',
  'unit',
  'cost_price',
  'sale_price',
  'status',
  'created_at',
  'updated_at',
] as const

const productCategories = new Set<Product['category']>([
  'dry-fruits',
  'dates',
  'perfume',
  'carpets',
])
const productUnits = new Set<Product['unit']>([
  'kg',
  'piece',
  'liter',
  'box',
])
const productStatuses = new Set<Product['status']>([
  'active',
  'inactive',
])
const formulaLikeText = /^[=+\-@]/

export interface ParsedProductImportRow {
  row: number
  name: string
  category: Product['category']
  unit: Product['unit']
  initialQuantity: number
  costPrice: number
  salePrice: number
  status: Product['status']
}

export type ProductWorkbookPreflightResult =
  | {
      ok: true
      rows: readonly ParsedProductImportRow[]
    }
  | {
      ok: false
      errors: readonly ProductWorkbookRowError[]
    }

export async function createProductImportTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Madina Platform'
  workbook.created = new Date('2026-01-01T00:00:00.000Z')
  workbook.modified = workbook.created

  const worksheet = workbook.addWorksheet(
    PRODUCT_IMPORT_WORKSHEET_NAME,
  )
  worksheet.getCell('A1').value = PRODUCT_IMPORT_TEMPLATE_VERSION
  worksheet.getCell('A2').value =
    'Required: name, category, unit, cost_price, sale_price. Optional: initial_quantity (0), status (active).'
  worksheet.getRow(3).values = [...PRODUCT_IMPORT_HEADERS]
  worksheet.getRow(4).values = [
    'Dates Medjool',
    'dates',
    'kg',
    0,
    10,
    15,
    'active',
  ]
  worksheet.getRow(3).font = { bold: true }
  worksheet.columns = PRODUCT_IMPORT_HEADERS.map((header) => ({
    key: header,
    width: Math.max(header.length + 2, 16),
  }))

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function createProductExportWorkbook(
  products: readonly Product[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Products')
  worksheet.getRow(1).values = [...PRODUCT_EXPORT_HEADERS]
  worksheet.getRow(1).font = { bold: true }

  for (const product of products) {
    worksheet.addRow([
      safeSpreadsheetText(product.id),
      safeSpreadsheetText(product.name),
      safeSpreadsheetText(product.category),
      product.quantity,
      safeSpreadsheetText(product.unit),
      product.costPrice,
      product.salePrice,
      safeSpreadsheetText(product.status),
      product.createdAt.toISOString(),
      product.updatedAt.toISOString(),
    ])
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function parseProductImportWorkbook(
  bytes: Buffer,
): Promise<ProductWorkbookPreflightResult> {
  const errors: ProductWorkbookRowError[] = []

  if (bytes.length === 0 || bytes.length > PRODUCT_IMPORT_MAX_BYTES) {
    addError(errors, {
      row: 0,
      code: 'invalid_file_size',
      message: `Workbook must be no larger than ${PRODUCT_IMPORT_MAX_BYTES} bytes.`,
    })
    return { ok: false, errors }
  }

  if (!isZipFile(bytes)) {
    addError(errors, {
      row: 0,
      code: 'invalid_xlsx',
      message: 'Workbook must be a valid XLSX file.',
    })
    return { ok: false, errors }
  }

  const zipInspection = inspectZipContainer(bytes)
  if (!zipInspection.ok) {
    addError(errors, {
      row: 0,
      code: zipInspection.code,
      message: zipInspection.message,
    })
    return { ok: false, errors }
  }

  if (
    zipInspection.entryNames.some(isForbiddenPackageEntry) ||
    containsForbiddenPackageText(bytes)
  ) {
    addError(errors, {
      row: 0,
      code: 'unsafe_workbook_content',
      message: 'Workbook contains unsupported macro or external-link content.',
    })
    return { ok: false, errors }
  }

  const workbook = new ExcelJS.Workbook()

  try {
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    )
  } catch {
    addError(errors, {
      row: 0,
      code: 'invalid_xlsx',
      message: 'Workbook could not be read as XLSX.',
    })
    return { ok: false, errors }
  }

  const worksheet = getExpectedWorksheet(workbook, errors)
  if (!worksheet) return { ok: false, errors }

  validateWorkbookCells(worksheet, errors)
  if (errors.length > 0) return { ok: false, errors }

  if (worksheet.getCell('A1').value !== PRODUCT_IMPORT_TEMPLATE_VERSION) {
    addError(errors, {
      row: 1,
      column: 'A',
      code: 'invalid_template_version',
      message: `Expected template version ${PRODUCT_IMPORT_TEMPLATE_VERSION}.`,
    })
  }

  validateHeaders(worksheet, errors)
  if (errors.length > 0) return { ok: false, errors }

  const parsedRows: ParsedProductImportRow[] = []
  const seenNames = new Set<string>()
  let dataRowCount = 0

  worksheet.eachRow((worksheetRow, rowNumber) => {
    if (rowNumber <= 3 || errors.length >= PRODUCT_IMPORT_MAX_ERRORS) return
    if (!rowHasValues(worksheetRow)) return

    dataRowCount += 1

    if (dataRowCount > PRODUCT_IMPORT_MAX_ROWS) {
      addError(errors, {
        row: rowNumber,
        code: 'too_many_rows',
        message: `Workbook cannot contain more than ${PRODUCT_IMPORT_MAX_ROWS} data rows.`,
      })
      return
    }

    const name = readText(worksheetRow.getCell(1), rowNumber, 'name', errors)
    const category = readEnum(
      worksheetRow.getCell(2), rowNumber, 'category', productCategories, errors,
    )
    const unit = readEnum(
      worksheetRow.getCell(3), rowNumber, 'unit', productUnits, errors,
    )
    const initialQuantity = readNumber(
      worksheetRow.getCell(4), rowNumber, 'initial_quantity', 0, errors,
    )
    const costPrice = readNumber(
      worksheetRow.getCell(5), rowNumber, 'cost_price', undefined, errors,
    )
    const salePrice = readNumber(
      worksheetRow.getCell(6), rowNumber, 'sale_price', undefined, errors,
    )
    const status = readEnum(
      worksheetRow.getCell(7), rowNumber, 'status', productStatuses, errors, 'active',
    )

    if (
      name === undefined || category === undefined || unit === undefined ||
      initialQuantity === undefined || costPrice === undefined ||
      salePrice === undefined || status === undefined
    ) return

    const nameKey = name
    if (nameKey && seenNames.has(nameKey)) {
      addError(errors, {
        row: rowNumber,
        column: 'name',
        code: 'duplicate_row',
        message: 'Duplicate product name within workbook.',
      })
      return
    }
    if (nameKey) seenNames.add(nameKey)

    parsedRows.push({
      row: rowNumber,
      name,
      category,
      unit,
      initialQuantity,
      costPrice,
      salePrice,
      status,
    })
  })

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, rows: parsedRows }
}

function getExpectedWorksheet(
  workbook: ExcelJS.Workbook,
  errors: ProductWorkbookRowError[],
): ExcelJS.Worksheet | undefined {
  const expected = workbook.getWorksheet(PRODUCT_IMPORT_WORKSHEET_NAME)

  if (!expected) {
    addError(errors, {
      row: 0,
      code: 'missing_worksheet',
      message: `Expected worksheet ${PRODUCT_IMPORT_WORKSHEET_NAME}.`,
    })
    return undefined
  }

  if (workbook.worksheets.length !== 1) {
    addError(errors, {
      row: 0,
      code: 'unexpected_worksheet',
      message: 'Workbook must contain exactly one expected worksheet.',
    })
  }

  if (expected.state !== 'visible') {
    addError(errors, {
      row: 0,
      code: 'hidden_worksheet',
      message: 'Expected worksheet must be visible.',
    })
  }

  return errors.length === 0 ? expected : undefined
}

function validateHeaders(
  worksheet: ExcelJS.Worksheet,
  errors: ProductWorkbookRowError[],
): void {
  if (worksheet.actualColumnCount > PRODUCT_IMPORT_HEADERS.length) {
    addError(errors, {
      row: 3,
      code: 'unexpected_column',
      message: 'Workbook contains unexpected columns.',
    })
  }

  const headers = PRODUCT_IMPORT_HEADERS.map((_, index) => {
    const value = worksheet.getRow(3).getCell(index + 1).value
    return typeof value === 'string' ? value.trim() : ''
  })
  const nonEmptyHeaders = headers.filter(Boolean)

  if (new Set(nonEmptyHeaders).size !== nonEmptyHeaders.length) {
    addError(errors, {
      row: 3,
      code: 'duplicate_header',
      message: 'Workbook contains duplicate headers.',
    })
    return
  }

  for (const [index, expected] of PRODUCT_IMPORT_HEADERS.entries()) {
    if (!headers[index]) {
      addError(errors, {
        row: 3,
        column: expected,
        code: 'missing_header',
        message: `Missing required header ${expected}.`,
      })
      continue
    }

    if (headers[index] !== expected) {
      addError(errors, {
        row: 3,
        column: headers[index],
        code: 'unexpected_header',
        message: `Expected header ${expected}.`,
      })
    }
  }
}

function validateWorkbookCells(
  worksheet: ExcelJS.Worksheet,
  errors: ProductWorkbookRowError[],
): void {
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, columnNumber) => {
      if (isUnsafeCell(cell)) {
        addError(errors, {
          row: rowNumber,
          column: rowNumber > 3 && columnNumber <= PRODUCT_IMPORT_HEADERS.length
            ? PRODUCT_IMPORT_HEADERS[columnNumber - 1]
            : cell.address || String(columnNumber),
          code: 'unsafe_cell',
          message: 'Formula, hyperlink, rich-text, and cached formula values are not accepted.',
        })
      }
    })
  })
}

function rowHasValues(row: ExcelJS.Row): boolean {
  return row.actualCellCount > 0
}

function isUnsafeCell(cell: ExcelJS.Cell): boolean {
  return cell.type === ExcelJS.ValueType.Formula ||
    cell.isHyperlink ||
    cell.type === ExcelJS.ValueType.RichText ||
    cell.type === ExcelJS.ValueType.Error
}

function readText(
  cell: ExcelJS.Cell,
  row: number,
  column: string,
  errors: ProductWorkbookRowError[],
): string | undefined {
  if (cell.value === null || cell.value === undefined) return ''

  if (typeof cell.value !== 'string') {
    addError(errors, {
      row,
      column,
      code: 'invalid_text',
      message: `${column} must be a text cell.`,
    })
    return undefined
  }

  const value = cell.value.trim()
  if (formulaLikeText.test(value)) {
    addError(errors, {
      row,
      column,
      code: 'unsafe_text',
      message: `${column} cannot start with a spreadsheet formula prefix.`,
    })
    return undefined
  }

  return value
}

function readEnum<T extends string>(
  cell: ExcelJS.Cell,
  row: number,
  column: string,
  values: ReadonlySet<T>,
  errors: ProductWorkbookRowError[],
  defaultValue?: T,
): T | undefined {
  if (cell.value === null || cell.value === undefined || cell.value === '') {
    return defaultValue === undefined
      ? invalidEnum(row, column, values, errors)
      : defaultValue
  }

  const text = readText(cell, row, column, errors)
  if (text === undefined) return undefined

  if (!values.has(text as T)) {
    return invalidEnum(row, column, values, errors)
  }

  return text as T
}

function invalidEnum<T extends string>(
  row: number,
  column: string,
  values: ReadonlySet<T>,
  errors: ProductWorkbookRowError[],
): undefined {
  addError(errors, {
    row,
    column,
    code: 'invalid_enum',
    message: `${column} must be one of: ${[...values].join(', ')}.`,
  })
  return undefined
}

function readNumber(
  cell: ExcelJS.Cell,
  row: number,
  column: string,
  defaultValue: number | undefined,
  errors: ProductWorkbookRowError[],
): number | undefined {
  if (cell.value === null || cell.value === undefined || cell.value === '') {
    if (defaultValue !== undefined) return defaultValue
    addError(errors, {
      row,
      column,
      code: 'invalid_number',
      message: `${column} must be a finite numeric cell.`,
    })
    return undefined
  }

  if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) {
    addError(errors, {
      row,
      column,
      code: 'invalid_number',
      message: `${column} must be a finite numeric cell.`,
    })
    return undefined
  }

  return cell.value
}

function isZipFile(bytes: Buffer): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
}

function isForbiddenPackageEntry(entryName: string): boolean {
  return entryName === 'xl/vbaProject.bin' ||
    entryName.startsWith('xl/externalLinks/')
}

function containsForbiddenPackageText(bytes: Buffer): boolean {
  const packageText = bytes.toString('latin1')
  return packageText.includes('xl/vbaProject.bin') ||
    packageText.includes('xl/externalLinks/')
}

type ZipInspection =
  | { ok: true; entryNames: readonly string[] }
  | { ok: false; code: string; message: string }

function inspectZipContainer(bytes: Buffer): ZipInspection {
  const endOfCentralDirectory = findEndOfCentralDirectory(bytes)
  if (endOfCentralDirectory === undefined) {
    return invalidZipInspection('Workbook ZIP central directory is missing.')
  }

  const entryCount = bytes.readUInt16LE(endOfCentralDirectory + 10)
  const centralDirectorySize = bytes.readUInt32LE(endOfCentralDirectory + 12)
  let offset = bytes.readUInt32LE(endOfCentralDirectory + 16)

  if (
    entryCount > PRODUCT_IMPORT_MAX_ZIP_ENTRIES ||
    offset + centralDirectorySize > bytes.length
  ) {
    return invalidZipInspection('Workbook ZIP structure exceeds supported limits.')
  }

  const entryNames: string[] = []
  let totalUncompressedBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      return invalidZipInspection('Workbook ZIP entry is invalid.')
    }

    const flags = bytes.readUInt16LE(offset + 8)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength

    if (
      flags & 0x0001 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      nextOffset > bytes.length
    ) {
      return invalidZipInspection('Workbook ZIP entry is unsupported.')
    }

    totalUncompressedBytes += uncompressedSize
    if (
      totalUncompressedBytes > PRODUCT_IMPORT_MAX_UNCOMPRESSED_BYTES ||
      (uncompressedSize > 1_024 * 1_024 &&
        (compressedSize === 0 || uncompressedSize > compressedSize * 100))
    ) {
      return {
        ok: false,
        code: 'unsafe_workbook_content',
        message: 'Workbook ZIP compression exceeds supported safety limits.',
      }
    }

    entryNames.push(bytes.toString('utf8', offset + 46, offset + 46 + nameLength))
    offset = nextOffset
  }

  return { ok: true, entryNames }
}

function findEndOfCentralDirectory(bytes: Buffer): number | undefined {
  const minimumOffset = Math.max(0, bytes.length - 65_557)

  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset
  }

  return undefined
}

function invalidZipInspection(message: string): ZipInspection {
  return {
    ok: false,
    code: 'invalid_xlsx',
    message,
  }
}

function addError(
  errors: ProductWorkbookRowError[],
  error: ProductWorkbookRowError,
): void {
  if (errors.length < PRODUCT_IMPORT_MAX_ERRORS) errors.push(error)
}

function safeSpreadsheetText(value: string): string {
  return formulaLikeText.test(value) ? `'${value}` : value
}
