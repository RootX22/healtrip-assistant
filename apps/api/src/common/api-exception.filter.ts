// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ErrorResponse } from "@healtrip/contracts";
import type { Request, Response } from "express";

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "invalid_request",
  [HttpStatus.NOT_FOUND]: "not_found",
  [HttpStatus.CONFLICT]: "conflict",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "payload_too_large",
  [HttpStatus.TOO_MANY_REQUESTS]: "rate_limited",
  [HttpStatus.SERVICE_UNAVAILABLE]: "unavailable",
};

/** Errors raised by the body parser before any route runs (the http-errors convention). */
interface ParserError {
  status: number;
  type?: string;
  expose?: boolean;
}

const isParserError = (error: unknown): error is ParserError =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as ParserError).status === "number" &&
  (error as ParserError).expose === true;

const PARSER_MESSAGES: Record<string, string> = {
  "entity.too.large": "The request body is too large.",
  "entity.parse.failed": "The request body is not valid JSON.",
};

// Framework-raised exceptions carry the framework's wording ("Cannot GET /x",
// "Unexpected end of JSON input"). Only exceptions this API raised itself,
// which carry a `code`, reach the client verbatim; the rest get these.
const GENERIC_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "The request could not be read.",
  [HttpStatus.NOT_FOUND]: "Not found.",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "The request body is too large.",
  [HttpStatus.TOO_MANY_REQUESTS]: "Too many requests. Please wait a moment and try again.",
};

interface Described {
  status: number;
  code: string;
  message: string;
}

const UNEXPECTED: Described = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: "internal_error",
  message: "Something went wrong on our side. Please try again.",
};

/** Status, code and client-safe message for anything a request can throw. */
function describe(exception: unknown): Described | null {
  if (isParserError(exception)) {
    return {
      status: exception.status,
      code: CODE_BY_STATUS[exception.status] ?? "invalid_request",
      message: PARSER_MESSAGES[exception.type ?? ""] ?? "The request could not be read.",
    };
  }
  if (!(exception instanceof HttpException)) return null;
  const status = exception.getStatus();
  const body = exception.getResponse() as { code?: unknown; message?: unknown } | string;
  if (
    typeof body === "object" &&
    typeof body.code === "string" &&
    typeof body.message === "string"
  ) {
    return { status, code: body.code, message: body.message };
  }
  return {
    status,
    code: CODE_BY_STATUS[status] ?? "error",
    message: GENERIC_BY_STATUS[status] ?? "The request could not be completed.",
  };
}

/**
 * Every error leaves the API in one shape, with the request id the client can
 * quote. Unexpected errors are logged in full here and reach the client only
 * as a generic message: stack traces and driver errors stay on the server.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("http");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const requestId = request.header("x-request-id");
    const described = describe(exception);
    if (described === null) {
      this.logger.error(
        `unhandled error on ${request.method} ${request.path} [${requestId ?? "-"}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    const { status, code, message } = described ?? UNEXPECTED;
    const payload: ErrorResponse = { error: { code, message, requestId } };
    http.getResponse<Response>().status(status).json(payload);
  }
}
