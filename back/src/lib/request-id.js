import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  const supplied = req.get('x-request-id');
  const id = typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  res.locals.requestId = id;
  res.set('x-request-id', id);
  next();
}
