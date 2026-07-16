import { describe, it, expect } from 'vitest'
import { allowedCrafts, canApproveStatus, canEditOutput, canViewCraft, setAuthorizedCrafts, visibleCraft } from '../src/utils/permissions'

describe('permissions', () => {
  it('only finance_cost can edit output', () => {
    expect(canEditOutput('finance_cost')).toBe(true)
    expect(canEditOutput('buyer_injection')).toBe(false)
    expect(canEditOutput('admin')).toBe(true)
  })
  it('only sc_manager/admin approve status', () => {
    expect(canApproveStatus('sc_manager')).toBe(true)
    expect(canApproveStatus('buyer_injection')).toBe(false)
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
    expect(allowedCrafts()).toHaveLength(4)
  })
})
