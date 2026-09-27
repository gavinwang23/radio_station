export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const known = error instanceof AppError;
  let status = known ? error.status : 500;
  let code = known ? error.code : 'INTERNAL_ERROR';
  let message = known ? error.message : 'An unexpected error occurred';
  if (error.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Request body must be valid JSON';
  } else if (error.type === 'entity.too.large') {
    status = 413; code = 'BODY_TOO_LARGE'; message = 'Request body is too large';
  } else if (error instanceof URIError) {
    status = 400; code = 'INVALID_PATH'; message = 'Request path is invalid';
  }
  res.status(status).json({ ok: false, error: { code, message }, meta: { requestId: res.locals.requestId } });
}
