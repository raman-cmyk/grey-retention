/**
 * Shared look for text inputs, selects and text areas (docs/DESIGN.md →
 * Form controls): white fill, 1px AA outline, 4px radius, 15px text and the
 * blue focus ring. Use it for every native control so forms stay consistent.
 */
export const controlClass =
  'min-h-10 w-full rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)] transition-[border-color,box-shadow] outline-hidden placeholder:text-[var(--text-faint)] hover:border-[var(--text-muted)] focus:border-[var(--focus)] focus:ring-1 focus:ring-[var(--focus)] disabled:cursor-not-allowed disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-muted)] aria-[invalid=true]:border-[var(--danger)]'
