import { createContext, useContext, useLayoutEffect, useRef } from 'react'

export type ShipmentDraftCommit = () => boolean | Promise<boolean>
export const ShipmentSheetDraftContext = createContext<((commit: ShipmentDraftCommit, pending: () => Promise<boolean> | null) => () => void) | null>(null)
export const ShipmentSheetFillContext = createContext<((source: number, target: number, field: string) => void) | null>(null)

/** The selected editor finishes validation before a paste or fill uses its value. */
export function useShipmentSheetDraft(commit: ShipmentDraftCommit, pending: () => Promise<boolean> | null) {
  const register = useContext(ShipmentSheetDraftContext)
  const latest = useRef({ commit, pending })
  latest.current = { commit, pending }
  useLayoutEffect(() => register?.(() => latest.current.commit(), () => latest.current.pending()), [register])
}
