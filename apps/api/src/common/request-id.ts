// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const ACCEPTABLE_ID = /^[\w-]{8,64}$/;

/** Reuses a well-formed incoming X-Request-Id or mints one, and echoes it back. */
export function requestId(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.header("x-request-id");
  const id = incoming && ACCEPTABLE_ID.test(incoming) ? incoming : randomUUID();
  request.headers["x-request-id"] = id;
  response.setHeader("x-request-id", id);
  next();
}
