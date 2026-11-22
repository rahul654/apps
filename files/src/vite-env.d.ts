/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides FILES_URL (src/config.ts), e.g. the local mock: http://localhost:4336/exec */
  readonly VITE_FILES_URL?: string;
  /** Serves thumbnails/previews/downloads from the local mock instead of drive.google.com. */
  readonly VITE_FILES_MEDIA?: string;
}
