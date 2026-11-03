import type { MetaDescriptor } from 'react-router';
import brand from '../../../config/brand.json';
import { publicPath } from '../src/public-routes';

export function pageMeta(routeId: string, title: string, description: string): MetaDescriptor[] {
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: `${brand.appUrl}${publicPath(routeId)}` },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: `${brand.appUrl}${publicPath(routeId)}` },
    { property: 'og:image', content: `${brand.appUrl}${brand.assets.socialImage.path}` },
  ];
}
