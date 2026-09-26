/** Timeouts abandon read results; they must never retry an uncertain write. */
export function readDeadline<T>(
  operation: Promise<T>,
  milliseconds = 10000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Reading this note is taking too long. Your current draft is preserved. Select the note again to retry.",
          ),
        ),
      milliseconds,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
