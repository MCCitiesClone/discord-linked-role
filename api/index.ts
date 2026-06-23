import { handle } from '@hono/node-server/vercel';
import type { IncomingMessage, ServerResponse } from 'node:http';

import app from '../src/app.js';

const handler = handle(app);

type VercelRequest = IncomingMessage & {
  body?: unknown;
  rawBody?: Buffer;
};

export default function vercelHandler(req: VercelRequest, res: ServerResponse) {
  if (!req.rawBody && req.body !== undefined) {
    req.rawBody = Buffer.from(serializeVercelBody(req.body, req.headers['content-type']));
  }

  return handler(req, res);
}

function serializeVercelBody(body: unknown, contentTypeHeader: string | string[] | undefined) {
  if (typeof body === 'string') {
    return body;
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body && typeof body === 'object') {
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader;

    if (contentType?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      return new URLSearchParams(
        Object.entries(body).flatMap(([key, value]) => {
          if (Array.isArray(value)) {
            return value.map((item) => [key, String(item)]);
          }

          return [[key, String(value)]];
        }),
      ).toString();
    }

    return JSON.stringify(body);
  }

  return '';
}
