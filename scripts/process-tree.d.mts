export function stopProcessTree(
  rootPid: number,
  signal?: NodeJS.Signals
): Promise<number[]>
