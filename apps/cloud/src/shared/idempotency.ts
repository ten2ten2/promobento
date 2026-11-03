import {canonical} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';

/** Resolved by the trusted business handler, never taken from caller identity headers. */
export type RequestScope = Readonly<{
  workspaceId: string;
  projectId: string | null;
  actorId: string;
  routeId: string;
  /** Exact parameters matched by Core (never raw client headers). */
  routeParams: Readonly<Record<string, string>>;
}>;

export type RequestIdentity = Readonly<{
  key: string;
  scope: RequestScope;
  requestId: string;
  requestHash: string;
}>;

export class IdempotencyConflict extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  readonly retryable = false;
  constructor() {super('IDEMPOTENCY_CONFLICT'); this.name = 'IdempotencyConflict';}
}

function identifier(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new TypeError('INVALID_IDEMPOTENCY_ID');
  }
  canonical(value); // The shared JSON boundary rejects lone UTF-16 surrogates.
  return value;
}

/** Ordinary business writes only; authentication and provider callbacks have separate rules. */
export function resolveRequestId(requestId: string | null | undefined,
  idempotencyKey: string | null | undefined): string {
  if (requestId == null && idempotencyKey == null) throw new TypeError('IDEMPOTENCY_KEY_REQUIRED');
  if (requestId != null) identifier(requestId);
  if (idempotencyKey != null) identifier(idempotencyKey);
  if (requestId != null && idempotencyKey != null && requestId !== idempotencyKey) throw new IdempotencyConflict();
  return requestId ?? idempotencyKey!;
}

/** The body digest is deliberately not part of the key: a changed body must conflict. */
export function requestIdentity(scope: RequestScope, requestId: string, requestHash: string): RequestIdentity {
  if (!scope.routeParams || typeof scope.routeParams !== 'object' || Array.isArray(scope.routeParams)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(scope.routeParams))) {
    throw new TypeError('INVALID_ROUTE_PARAMS');
  }
  const routeParams = Object.fromEntries(Object.entries(scope.routeParams).map(([key, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)) throw new TypeError('INVALID_ROUTE_PARAMS');
    return [key, identifier(value)];
  }));
  const resolvedScope: RequestScope = Object.freeze({
    workspaceId: identifier(scope.workspaceId),
    projectId: scope.projectId === null ? null : identifier(scope.projectId),
    actorId: identifier(scope.actorId),
    routeId: identifier(scope.routeId),
    routeParams: Object.freeze(routeParams),
  });
  identifier(requestId);
  if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(requestHash)) {
    throw new TypeError('INVALID_REQUEST_HASH');
  }
  return Object.freeze({
    key: digest({scope: resolvedScope, requestId}), scope: resolvedScope, requestId, requestHash,
  });
}
