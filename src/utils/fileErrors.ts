export function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
