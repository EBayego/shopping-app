export class ObservedIngestionError extends Error {
  constructor(readonly originalError: unknown) {
    super(errorMessage(originalError), { cause: originalError });
    this.name = "ObservedIngestionError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
