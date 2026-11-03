// Deliberately small client-visible manifest. The repository check verifies
// this against the planned routes and the executable React Router registry.
export const publicPages = [
  {id: 'public.home', path: '/', kind: 'page', auth: 'public'},
  {id: 'public.formats', path: '/formats', kind: 'page', auth: 'public'},
  {id: 'public.help', path: '/help', kind: 'page', auth: 'public'},
] as const;

export function publicPath(id: string): string {
  const route = publicPages.find((candidate) => candidate.id === id);
  if (!route || route.kind !== 'page' || route.auth !== 'public' || route.path.includes(':')) {
    throw new Error(`Unimplemented public page: ${id}`);
  }
  return route.path;
}
