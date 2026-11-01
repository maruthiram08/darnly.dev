import type { Plugin } from 'vite';
import { PRODUCTS } from './src/data/products';

const ORDERS = [
  { id: 'A-1042', date: '2026-10-02', total: 46, status: 'delivered', items: 1 },
  { id: 'A-1057', date: '2026-10-14', total: 70, status: 'shipped', items: 3 },
  { id: 'A-1063', date: '2026-10-27', total: 12, status: 'processing', items: 1 },
];

let settings = { displayName: 'Sam Rivera', email: 'sam@example.com', newsletter: true, orderUpdates: true };

/** A tiny fake backend served by the Vite dev server. */
export function mockApi(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const path = req.url.split('?')[0];
        if (path === '/api/products' && req.method === 'GET') return send(200, PRODUCTS);
        if (path === '/api/orders' && req.method === 'GET') return send(200, ORDERS);
        if (path === '/api/settings' && req.method === 'GET') return send(200, settings);
        if (path === '/api/settings' && req.method === 'POST') {
          let raw = '';
          req.on('data', (c) => (raw += c));
          req.on('end', () => {
            settings = { ...settings, ...JSON.parse(raw || '{}') };
            send(200, settings);
          });
          return;
        }
        if (path === '/api/checkout' && req.method === 'POST') return send(200, { orderId: 'A-1071' });
        if (path === '/api/newsletter' && req.method === 'POST') return send(200, { ok: true });
        send(404, { error: 'not found' });
      });
    },
  };
}
