import { act } from '@testing-library/react'

/**
 * jsdom has no `showModal`/`close`. This test-only stand-in keeps the `open`
 * attribute and the `close` event, which is all the components rely on.
 */
export function installDialogPolyfill() {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    __polyfilled?: boolean
  }
  if (proto.__polyfilled) return
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.show = proto.showModal
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
  proto.__polyfilled = true
}

/** Simulates the browser's Escape handling on the topmost open dialog. */
export function pressEscapeOn(dialog: HTMLDialogElement) {
  act(() => {
    const event = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(event)
    if (!event.defaultPrevented) dialog.close()
  })
}

/**
 * Simulates Chromium's close-watcher when a cancel may not be stopped (for
 * example a second Escape without a click in between): the cancel cannot be
 * prevented, and the dialogs in the group close from the top down.
 */
export function forceEscape(...dialogs: HTMLDialogElement[]) {
  act(() => {
    dialogs[0].dispatchEvent(new Event('cancel', { cancelable: false }))
    for (const dialog of dialogs) dialog.close()
  })
}
