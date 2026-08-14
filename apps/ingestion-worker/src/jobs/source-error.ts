export class AdapterSourceError extends Error {
  constructor(cause: unknown) {
    super(
      `merchant adapter source refresh failed: ${cause instanceof Error ? cause.message : "unknown source error"}`,
      { cause }
    );
    this.name = "AdapterSourceError";
  }
}

export function isAdapterSourceError(error: unknown): error is AdapterSourceError {
  return error instanceof AdapterSourceError;
}

export async function callAdapterSource<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new AdapterSourceError(error);
  }
}
