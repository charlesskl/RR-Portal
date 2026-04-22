import { pathToFileURL } from 'url'
import { dirname } from 'path'
export const __DIRNAME_SHIM = __dirname
export const __FILENAME_SHIM = __filename
export const __URL_SHIM = pathToFileURL(__filename).href
