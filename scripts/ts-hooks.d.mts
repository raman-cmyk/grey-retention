export function findFile(path: string): string | null
export function resolve(
  specifier: string,
  context: { parentURL?: string },
  next: (specifier: string, context: { parentURL?: string }) => unknown
): Promise<unknown>
