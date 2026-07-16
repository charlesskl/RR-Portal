import PocketBase from 'pocketbase'
import { resolvePocketBaseUrl } from './runtimeConfig'

const baseUrl = resolvePocketBaseUrl({
  basePath: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
  hostname: window.location.hostname,
  origin: window.location.origin,
  override: import.meta.env.VITE_POCKETBASE_URL,
})
export const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)
