import messages from '../../../locales/api-errors.en.json' with {type: 'json'};

const definitions = Object.freeze({
  NOT_FOUND: {key: 'notFound', retryable: false},
  METHOD_NOT_ALLOWED: {key: 'methodNotAllowed', retryable: false},
  IDEMPOTENCY_CONFLICT: {key: 'idempotencyConflict', retryable: false},
  PRECONDITION_FAILED: {key: 'preconditionFailed', retryable: false},
  OUTCOME_UNKNOWN: {key: 'outcomeUnknown', retryable: true},
  INTERNAL_ERROR: {key: 'internalError', retryable: false},
  SERVICE_UNAVAILABLE: {key: 'serviceUnavailable', retryable: true},
});

/** Only controlled public messages belong here; never pass provider exceptions. */
export function apiError(code, status, correlationId, headers, params = {}) {
  if (!Object.hasOwn(definitions, code)) throw new TypeError('Unknown public API error code');
  if (Object.keys(params).some(key => key !== 'reason') || (params.reason !== undefined &&
    (code !== 'PRECONDITION_FAILED' || typeof params.reason !== 'string'
      || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(params.reason)))) throw new TypeError('Unsafe public API error params');
  const definition = definitions[code];
  const responseHeaders = new Headers(headers);
  responseHeaders.set('cache-control', 'private, no-store');
  responseHeaders.set('x-content-type-options', 'nosniff');
  responseHeaders.set('x-robots-tag', 'noindex');
  responseHeaders.set('x-request-id', correlationId);
  return Response.json({code, messageKey: 'apiErrors.' + definition.key, params,
    message: messages[definition.key], fieldErrors: {}, retryable: definition.retryable, requestId: correlationId},
  {status, headers: responseHeaders});
}
