import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { registerRoutes, type RouteDeps } from './api/routes';
import type { EventHub, WsMessage } from './api/events';
import { registerStatic } from './static';

export interface ServerDeps extends RouteDeps {
  hub?: EventHub;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRoutes(app, deps);

  // The desktop shell asks the backend to host the built SPA so the window can
  // load it same-origin; tests and the Vite dev server leave this off.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const distDir = process.env.AW_DIST_DIR || (process.env.NODE_ENV === 'test' ? '' : path.join(repoRoot, 'frontend', 'dist'));
  if (distDir) registerStatic(app, distDir);

  if (deps.hub) {
    const hub = deps.hub;
    deps.orchestrator.setEventSink((msg: WsMessage) => hub.publish(msg));

    // The websocket plugin must be loaded before the route so its onRoute hook
    // turns `{ websocket: true }` into a WS handler.
    app.register(async (instance) => {
      await instance.register(websocket);
      instance.get('/ws', { websocket: true }, (socket: any) => {
        const off = hub.subscribe((msg: WsMessage) => socket.send(JSON.stringify(msg)));
        socket.on('close', off);
      });
    });
  }

  return app;
}
