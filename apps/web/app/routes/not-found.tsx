import messages from '../../../../locales/en.json';
export const meta = () => [{ title: messages.webShell.errors.notFoundMetaTitle }];
export function loader(): never { throw new Response(null, { status: 404, statusText: 'Not Found' }); }
export default function NotFound() { return null; }
