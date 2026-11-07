export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'error',
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have permission to perform this action') => new AppError(403, msg, 'forbidden');
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`, 'not_found');
export const conflict = (msg: string, details?: unknown) => new AppError(409, msg, 'conflict', details);
export const tooLarge = (msg: string) => new AppError(413, msg, 'payload_too_large');
export const unsupported = (msg: string) => new AppError(415, msg, 'unsupported_media_type');
