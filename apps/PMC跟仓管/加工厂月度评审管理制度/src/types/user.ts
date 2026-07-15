import type { Role, Craft } from '../constants/roles'
export interface AppUser {
  id: string
  email: string
  role: Role
  craft?: Craft
  display_name?: string
}
