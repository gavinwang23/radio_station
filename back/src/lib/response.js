export function sendData(res, data, status = 200) {
  return res.status(status).json({ ok: true, data, meta: { requestId: res.locals.requestId } });
}
