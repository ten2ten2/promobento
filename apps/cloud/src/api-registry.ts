import type {ApiHandler} from './api-dispatch.ts';

// Register a customer handler only with its config/implemented-routes.json entry
// and contracts/api/<routeId>.schema.json. PR1 exposes no customer business API.
export const apiHandlers: Readonly<Record<string, ApiHandler>> = Object.freeze({});
