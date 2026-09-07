import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  allowedCrafts,
  canAccessPath,
  canApproveScore,
  canApproveStatus,
  canEditOrders,
  canImportOrdersForScope,
  canEditOutput,
  canViewCraft,
  setAuthorizedCrafts,
  setPermissionOverrides,
  visibleCraft,
} from '../src/utils/permissions'
import { BUYER_CRAFT, isBuyer, ROLE_LABELS } from '../src/constants/roles'

describe('permissions', () => {
  beforeEach(() => {
    setPermissionOverrides(null)
    setAuthorizedCrafts(null)
  })
  afterEach(() => {
    setPermissionOverrides(null)
    setAuthorizedCrafts(null)
  })
  it('allows a general manager to open score sheets with scoring permission alone', () => {
    setPermissionOverrides({ 'scoring.view': true, 'factories.view': false })

    expect(canAccessPath('gm', '/scoring')).toBe(true)
    expect(canAccessPath('gm', '/factories/factory123/score/2026-07')).toBe(true)
    expect(canAccessPath('gm', '/factories/factory123/score/2026-07/')).toBe(true)
    expect(canAccessPath('gm', '/factories')).toBe(false)
    expect(canAccessPath('gm', '/factories/factory123')).toBe(false)
    expect(canAccessPath('gm', '/factories/new')).toBe(false)
    expect(canAccessPath('gm', '/factories/dept/injection')).toBe(false)
    expect(canApproveScore('gm')).toBe(false)
  })
  it('requires scoring permission for score sheets even when factories are accessible', () => {
    setPermissionOverrides({ 'scoring.view': false, 'factories.view': true })

    expect(canAccessPath('admin', '/scoring')).toBe(false)
    expect(canAccessPath('admin', '/factories/factory123/score/2026-07')).toBe(false)
    expect(canAccessPath('admin', '/factories')).toBe(true)
    expect(canAccessPath('admin', '/factories/factory123')).toBe(true)
  })
  it('keeps default scoring access and limits the exception to score sheet routes', () => {
    expect(canAccessPath('sc_manager', '/factories/factory123/score/2026-07')).toBe(true)
    expect(canAccessPath('admin', '/factories/factory123/score/2026-07')).toBe(true)
    expect(canAccessPath('gm', '/factories/factory123/score/2026-07')).toBe(false)

    setPermissionOverrides({ 'scoring.view': true, 'factories.view': false })
    expect(canAccessPath('gm', '/factories/factory123/score')).toBe(false)
    expect(canAccessPath('gm', '/factories/factory123/score/2026-07/edit')).toBe(false)
  })
  it('supports the electronics buyer role and maps it to the electronics department', () => {
    expect(ROLE_LABELS.buyer_electronics).toBe('电子部采购')
    expect(BUYER_CRAFT.buyer_electronics).toBe('electronics')
    expect(isBuyer('buyer_electronics')).toBe(true)
    expect(canEditOrders('buyer_electronics')).toBe(true)
  })
  it('only finance_cost can edit output', () => {
    expect(canEditOutput('finance_cost')).toBe(true)
    expect(canEditOutput('buyer_injection')).toBe(false)
    expect(canEditOutput('admin')).toBe(true)
  })
  it('only sc_manager/admin approve status', () => {
    expect(canApproveStatus('sc_manager')).toBe(true)
    expect(canApproveStatus('buyer_injection')).toBe(false)
  })
  it('uses the orders.edit override for all order editing actions', () => {
    setPermissionOverrides(null)
    expect(canEditOrders('buyer_injection')).toBe(true)
    expect(canEditOrders('quality_qc')).toBe(false)

    setPermissionOverrides({ 'orders.edit': false })
    expect(canEditOrders('buyer_injection')).toBe(false)

    setPermissionOverrides({ 'orders.edit': true })
    expect(canEditOrders('quality_qc')).toBe(true)
    setPermissionOverrides(null)
  })
  it('supports multiple authorized departments', () => {
    setAuthorizedCrafts(['painting', 'sewing'])
    expect(allowedCrafts()).toEqual(['painting', 'sewing'])
    expect(canViewCraft('painting')).toBe(true)
    expect(canViewCraft('injection')).toBe(false)
    expect(visibleCraft('buyer_painting')).toBeNull()
    setAuthorizedCrafts(['painting'])
    expect(visibleCraft('buyer_painting')).toBe('painting')
    setAuthorizedCrafts([])
    expect(allowedCrafts()).toHaveLength(5)
  })
  it('requires edit, department and region permissions for delivery imports', () => {
    setAuthorizedCrafts(['sewing'])
    setPermissionOverrides({ 'region.dongguan': true, 'region.hunan': false })
    expect(canImportOrdersForScope('buyer_sewing', 'sewing', 'dongguan')).toBe(true)
    expect(canImportOrdersForScope('buyer_sewing', 'sewing', 'hunan')).toBe(false)
    expect(canImportOrdersForScope('buyer_sewing', 'painting', 'dongguan')).toBe(false)
    expect(canImportOrdersForScope('buyer_sewing', 'sewing', null)).toBe(false)
    setPermissionOverrides({ 'orders.edit': false, 'region.dongguan': true })
    expect(canImportOrdersForScope('buyer_sewing', 'sewing', 'dongguan')).toBe(false)
    setPermissionOverrides(null)
    setAuthorizedCrafts([])
  })
})
