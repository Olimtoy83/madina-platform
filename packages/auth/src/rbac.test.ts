import {
  equal,
  throws,
} from 'node:assert/strict'
import test from 'node:test'
import {
  PermissionDeniedError,
  hasPermission,
  requirePermission,
} from './rbac.js'

test('viewer has read-only permissions', () => {
  equal(hasPermission('viewer', 'commerce:read'), true)
  equal(hasPermission('viewer', 'products:write'), false)
  throws(
    () => requirePermission('viewer', 'sales:write'),
    PermissionDeniedError,
  )
})

test('operator has client, task, and sales permissions', () => {
  equal(hasPermission('operator', 'clients:write'), true)
  equal(hasPermission('operator', 'tasks:write'), true)
  equal(hasPermission('operator', 'sales:write'), true)
  equal(hasPermission('operator', 'purchases:write'), false)
})

test('manager has purchase, product, and stock adjustment permissions', () => {
  equal(hasPermission('manager', 'purchases:write'), true)
  equal(hasPermission('manager', 'products:write'), true)
  equal(hasPermission('manager', 'stock:adjust'), true)
  equal(hasPermission('manager', 'users:manage'), false)
})

test('admin can manage users, read audit events, and import legacy data', () => {
  equal(hasPermission('admin', 'users:manage'), true)
  equal(hasPermission('admin', 'audit:read'), true)
  equal(hasPermission('admin', 'data:import'), true)
})

test('non-admin roles cannot read audit events', () => {
  equal(hasPermission('viewer', 'audit:read'), false)
  equal(hasPermission('operator', 'audit:read'), false)
  equal(hasPermission('manager', 'audit:read'), false)
})

test('Korea Auto reads are available to viewer and writes to operator and above', () => {
  equal(hasPermission('viewer', 'korea-auto:read'), true)
  equal(hasPermission('viewer', 'korea-auto:write'), false)
  equal(hasPermission('operator', 'korea-auto:write'), true)
  equal(hasPermission('manager', 'korea-auto:write'), true)
  equal(hasPermission('admin', 'korea-auto:write'), true)
})
