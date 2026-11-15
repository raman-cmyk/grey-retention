/**
 * The writer's rule for customer words (ONB-061), in a file of its own with
 * no imports, so the writer's rules (`features/assembly/assemble.ts`) can
 * import it without importing `customer-words.ts` back. The phrases go in
 * the writer's data under `customerWordsKey`.
 */
export const customerWordsKey = 'customerWords'

export const customerWordsRule = `${customerWordsKey} are phrases real customers use. Borrow their words and tone where they fit; never quote them, never put them in a customer's mouth, and never turn them into a promise about results, speed or being the best.`
