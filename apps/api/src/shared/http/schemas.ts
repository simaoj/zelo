import { z } from 'zod';
import { ApiError } from '@zelo/contracts';

/** Common error responses for OpenAPI documentation. */
export const errorResponses = {
  400: ApiError,
  401: ApiError,
  403: ApiError,
  404: ApiError,
  409: ApiError,
  422: ApiError,
  429: ApiError,
} as const;

export const IdParams = z.object({ id: z.uuid() });
export const NoContent = z.null().describe('No content');
