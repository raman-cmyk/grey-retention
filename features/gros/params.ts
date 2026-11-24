import { z } from 'zod'

/** The `chat` address parameter: a chat id, or nothing. */
export function validChatId(value: unknown) {
  return z.uuid().safeParse(value).success ? (value as string) : undefined
}

/**
 * The `before` address parameter: the message number the page of older
 * messages ends before (messages are read 100 at a time), or nothing.
 */
export function validMessageCursor(value: unknown) {
  const parsed = z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .safeParse(value)
  return parsed.success ? parsed.data : undefined
}
