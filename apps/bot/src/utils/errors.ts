/**
 * Error handling utilities
 * Provides type-safe error conversions and helpers
 */

/**
 * Safely converts unknown error to Error type
 * Handles cases where catch block receives non-Error values
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  
  if (typeof error === 'string') {
    return new Error(error);
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return new Error(String(error.message));
  }
  
  return new Error(String(error));
}

/**
 * Converts unknown error to Error | undefined
 * Useful for optional error parameters
 */
export function toErrorOrUndefined(error: unknown): Error | undefined {
  if (!error) return undefined;
  return toError(error);
}

/**
 * Extracts error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * Type guard to check if value is an Error
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}
