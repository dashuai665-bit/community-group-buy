export class ApiError extends Error {
  readonly status: 401 | 403 | 404 | 409 | 422;
  readonly code: string;

  constructor(status: 401 | 403 | 404 | 409 | 422, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: '伺服器暫時無法處理要求' } },
    { status: 500 },
  );
}
