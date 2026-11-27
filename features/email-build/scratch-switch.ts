/**
 * DES-ENGINE-004b: the owner's switch for Scratch from the block library
 * (`DESIGN_LIBRARY_SCRATCH=on`). Off unless set (off in production); on in
 * local fake runs (`scripts/local-runtime.mjs`). With it off a Scratch
 * email is drawn with the 20 coded blocks, as before, and the library
 * screen says the switch is off.
 */
export const libraryScratchOn = (
  env: Readonly<Record<string, string | undefined>>
) => env.DESIGN_LIBRARY_SCRATCH?.trim() === 'on'
