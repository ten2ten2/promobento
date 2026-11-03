import { index, route, type RouteConfig } from '@react-router/dev/routes';
import { publicPath } from '../src/public-routes.ts';

export default [
  index('routes/home.tsx', { id: 'public.home' }),
  route(publicPath('public.formats').slice(1), 'routes/formats.tsx', { id: 'public.formats' }),
  route(publicPath('public.help').slice(1), 'routes/help.tsx', { id: 'public.help' }),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
