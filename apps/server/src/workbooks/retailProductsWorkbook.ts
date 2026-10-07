import type { RetailProductPriceImportRow, RetailProductStatus } from '@madina/retail'
import ExcelJS from 'exceljs'
import { hasForbiddenWorkbookPackageEntry, inspectWorkbookZipContainer } from './workbookZipSafety.js'

export const RETAIL_PRODUCT_IMPORT_TEMPLATE_VERSION = 'sabono-retail-products-v1'
export const RETAIL_PRODUCT_IMPORT_WORKSHEET_NAME = 'Товары SABONO'
export const RETAIL_PRODUCT_WORKBOOK_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const RETAIL_PRODUCT_IMPORT_MAX_BYTES = 10 * 1_024 * 1_024
export const RETAIL_PRODUCT_IMPORT_MAX_ROWS = 1_000
export const RETAIL_PRODUCT_IMPORT_MAX_UNCOMPRESSED_BYTES = 50 * 1_024 * 1_024
export const RETAIL_PRODUCT_IMPORT_MAX_ZIP_ENTRIES = 100
export const RETAIL_PRODUCT_IMPORT_HEADERS = ['Артикул', 'Наименование', 'Штрихкод', 'Статус', 'Цена продажи'] as const

export interface RetailWorkbookError { row: number; column?: string; code: string; message: string }
export type RetailProductWorkbookPreflight =
  | { ok: true; rows: readonly RetailProductPriceImportRow[] }
  | { ok: false; errors: readonly RetailWorkbookError[] }

const statuses = new Set<RetailProductStatus>(['active', 'inactive'])
const formulaLikeText = /^[=+\-@]/

export async function createRetailProductImportTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Madina Platform'
  workbook.created = new Date('2026-01-01T00:00:00.000Z')
  workbook.modified = workbook.created
  const sheet = workbook.addWorksheet(RETAIL_PRODUCT_IMPORT_WORKSHEET_NAME)
  sheet.getCell('A1').value = RETAIL_PRODUCT_IMPORT_TEMPLATE_VERSION
  sheet.getCell('A2').value = 'Штрихкод необязателен. Статус: active или inactive. Цена продажи указывается точно в валюте выбранной точки.'
  sheet.getRow(3).values = [...RETAIL_PRODUCT_IMPORT_HEADERS]
  sheet.getRow(4).values = ['SAB-001', 'Пример товара', '460000000001', 'active', '12500']
  sheet.getRow(3).font = { bold: true }
  sheet.columns = [18, 34, 22, 14, 18].map((width, index) => ({ key: RETAIL_PRODUCT_IMPORT_HEADERS[index], width }))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function parseRetailProductImportWorkbook(bytes: Buffer, currencyExponent: number): Promise<RetailProductWorkbookPreflight> {
  const errors: RetailWorkbookError[] = []
  if (bytes.length === 0 || bytes.length > RETAIL_PRODUCT_IMPORT_MAX_BYTES) return invalid(errors, 0, 'invalid_file_size', `Размер XLSX не должен превышать ${RETAIL_PRODUCT_IMPORT_MAX_BYTES} байт.`)
  if (!isZip(bytes)) return invalid(errors, 0, 'invalid_xlsx', 'Файл должен быть XLSX-шаблоном SABONO.')
  const zipInspection = inspectWorkbookZipContainer(bytes, { maxEntries: RETAIL_PRODUCT_IMPORT_MAX_ZIP_ENTRIES, maxUncompressedBytes: RETAIL_PRODUCT_IMPORT_MAX_UNCOMPRESSED_BYTES })
  if (!zipInspection.ok) return invalid(errors, 0, zipInspection.code, zipInspection.message)
  if (hasForbiddenWorkbookPackageEntry(zipInspection.entryNames)) return invalid(errors, 0, 'unsafe_workbook_content', 'Файл содержит неподдерживаемые макросы или внешние ссылки.')
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]) } catch { return invalid(errors, 0, 'invalid_xlsx', 'Файл XLSX не удалось прочитать.') }
  const sheet = workbook.getWorksheet(RETAIL_PRODUCT_IMPORT_WORKSHEET_NAME)
  if (!sheet || workbook.worksheets.length !== 1 || sheet.state !== 'visible') return invalid(errors, 0, 'invalid_template', 'Нужен один видимый лист шаблона «Товары SABONO».')
  if (sheet.getCell('A1').value !== RETAIL_PRODUCT_IMPORT_TEMPLATE_VERSION) return invalid(errors, 1, 'invalid_template_version', 'Версия шаблона SABONO не поддерживается.')
  const headers = RETAIL_PRODUCT_IMPORT_HEADERS.map((_, index) => String(sheet.getRow(3).getCell(index + 1).value ?? '').trim())
  if (headers.length !== RETAIL_PRODUCT_IMPORT_HEADERS.length || headers.some((header, index) => header !== RETAIL_PRODUCT_IMPORT_HEADERS[index]) || sheet.actualColumnCount > RETAIL_PRODUCT_IMPORT_HEADERS.length) return invalid(errors, 3, 'invalid_headers', 'Столбцы шаблона SABONO были изменены.')
  const rows: RetailProductPriceImportRow[] = []
  const seenSourceIds = new Set<string>()
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3 || errors.length >= 100 || row.actualCellCount === 0) return
    if (rows.length >= RETAIL_PRODUCT_IMPORT_MAX_ROWS) { errors.push({ row: rowNumber, code: 'too_many_rows', message: 'В шаблоне слишком много строк.' }); return }
    if (row.eachCell((cell) => { if (cell.type === ExcelJS.ValueType.Formula || cell.isHyperlink || cell.type === ExcelJS.ValueType.RichText || cell.type === ExcelJS.ValueType.Error) errors.push({ row: rowNumber, code: 'unsafe_cell', message: 'Формулы, ссылки и форматированный текст не поддерживаются.' }) }), errors.length) return
    const sourceId = text(row.getCell(1).value); const name = text(row.getCell(2).value); const barcode = text(row.getCell(3).value); const status = text(row.getCell(4).value) || 'active'; const salePrice = text(row.getCell(5).value)
    if (!sourceId || !name || !salePrice) { errors.push({ row: rowNumber, code: 'required_value', message: 'Артикул, наименование и цена продажи обязательны.' }); return }
    if (formulaLikeText.test(sourceId) || formulaLikeText.test(name) || (barcode && !/^[0-9]{4,32}$/.test(barcode)) || !statuses.has(status as RetailProductStatus)) { errors.push({ row: rowNumber, code: 'invalid_row', message: 'Проверьте артикул, наименование, штрихкод и статус.' }); return }
    const unitPriceMinor = parsePrice(salePrice, currencyExponent)
    if (unitPriceMinor === undefined || unitPriceMinor <= 0) { errors.push({ row: rowNumber, column: 'sale_price', code: 'invalid_price', message: 'Цена продажи должна быть точной положительной суммой для валюты выбранной точки.' }); return }
    if (seenSourceIds.has(sourceId)) { errors.push({ row: rowNumber, column: 'Артикул', code: 'duplicate_row', message: 'Артикул повторяется в шаблоне.' }); return }
    seenSourceIds.add(sourceId)
    rows.push({ sourceRef: String(rowNumber), sourceId, name, barcode: barcode || undefined, status: status as RetailProductStatus, unitPriceMinor })
  })
  return errors.length ? { ok: false, errors } : { ok: true, rows }
}

function invalid(errors: RetailWorkbookError[], row: number, code: string, message: string): RetailProductWorkbookPreflight { errors.push({ row, code, message }); return { ok: false, errors } }
function text(value: ExcelJS.CellValue): string { if (typeof value === 'string' || typeof value === 'number') return String(value).trim(); return '' }
function parsePrice(value: string, exponent: number): number | undefined { const match = /^(\d+)(?:[.,](\d+))?$/.exec(value); if (!match || exponent < 0 || exponent > 9 || (match[2]?.length ?? 0) > exponent) return undefined; const minor = `${match[1]}${(match[2] ?? '').padEnd(exponent, '0')}`; const parsed = Number(minor); return Number.isSafeInteger(parsed) ? parsed : undefined }
function isZip(bytes: Buffer): boolean { return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) }
