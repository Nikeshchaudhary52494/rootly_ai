import type { NextFunction, Request, RequestHandler, Response } from 'express';

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  503: 'Service Unavailable',
};

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string | string[],
  ) {
    super(Array.isArray(message) ? message.join(', ') : message);
    this.payload = message;
  }

  payload: string | string[];
}

export function notFound(message: string) {
  return new AppError(404, message);
}

export function conflict(message: string) {
  return new AppError(409, message);
}

export function badRequest(message: string | string[]) {
  return new AppError(400, message);
}

export function statusText(code: number) {
  return STATUS_TEXT[code] ?? 'Error';
}

/** Express 4 doesn't forward rejected promises to error middleware on its own. */
export function wrap(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
