/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base path of the API, e.g. `/api/v1` (default) or an absolute origin. */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
