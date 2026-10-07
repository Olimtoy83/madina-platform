import { deepEqual, equal } from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { createRetailProductImportTemplateWorkbook, parseRetailProductImportWorkbook, RETAIL_PRODUCT_IMPORT_TEMPLATE_VERSION, RETAIL_PRODUCT_IMPORT_WORKSHEET_NAME } from './retailProductsWorkbook.js'

test('Retail catalog workbook has a versioned retail-only contract and parses exact prices', async () => {
  const bytes = await createRetailProductImportTemplateWorkbook()
  const parsed = await parseRetailProductImportWorkbook(bytes, 2)
  equal(parsed.ok, true)
  if (!parsed.ok) return
  equal(parsed.rows[0]?.sourceId, 'SAB-001')
  equal(parsed.rows[0]?.unitPriceMinor, 1_250_000)
  deepEqual(Object.keys(parsed.rows[0] ?? {}).sort(), ['barcode', 'name', 'sourceId', 'sourceRef', 'status', 'unitPriceMinor'].sort())
})

test('Retail catalog workbook rejects altered version, unsafe values, invalid barcode and fractional price', async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(RETAIL_PRODUCT_IMPORT_WORKSHEET_NAME)
  sheet.getCell('A1').value = RETAIL_PRODUCT_IMPORT_TEMPLATE_VERSION
  sheet.getRow(3).values = ['Артикул', 'Наименование', 'Штрихкод', 'Статус', 'Цена продажи']
  sheet.getRow(4).values = ['=unsafe', 'Tea', 'bad barcode', 'other', '12.5']
  const parsed = await parseRetailProductImportWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 0)
  equal(parsed.ok, false)
})

test('Retail catalog workbook rejects malformed and compressed ZIP expansion before workbook loading', async () => {
  const malformed = await parseRetailProductImportWorkbook(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 0)
  equal(malformed.ok, false)
  const bytes = Buffer.alloc(72); bytes.writeUInt32LE(0x04034b50, 0); bytes.writeUInt32LE(0x02014b50, 4); bytes.writeUInt32LE(1, 24); bytes.writeUInt32LE(51 * 1_024 * 1_024, 28); bytes.writeUInt32LE(0x06054b50, 50); bytes.writeUInt16LE(1, 58); bytes.writeUInt16LE(1, 60); bytes.writeUInt32LE(46, 62); bytes.writeUInt32LE(4, 66)
  const unsafe = await parseRetailProductImportWorkbook(bytes, 0)
  equal(unsafe.ok, false)
  if (!unsafe.ok) equal(unsafe.errors[0]?.code, 'unsafe_workbook_content')
})
