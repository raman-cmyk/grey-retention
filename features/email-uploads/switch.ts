/**
 * DES-ENGINE-003: the owner's switch for "Add your own email" and for
 * Create email copying an uploaded design (`DESIGN_UPLOAD_COPY=on`). Off
 * unless set (off in production); on in local fake runs and the browser
 * journeys (`scripts/local-runtime.mjs`). With it off the page says it is
 * not turned on, the measuring job claims nothing, and no upload is used.
 */
export const uploadCopyOn = (
  env: Readonly<Record<string, string | undefined>>
) => env.DESIGN_UPLOAD_COPY?.trim() === 'on'
