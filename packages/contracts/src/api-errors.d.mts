export type PublicApiErrorCode = 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'IDEMPOTENCY_CONFLICT'
  | 'PRECONDITION_FAILED' | 'OUTCOME_UNKNOWN' | 'INTERNAL_ERROR' | 'SERVICE_UNAVAILABLE';
export function apiError(code: PublicApiErrorCode, status: number, correlationId: string,
  headers?: HeadersInit, params?: Readonly<{reason?: string}>): Response;
