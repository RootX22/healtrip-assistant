// Copyright (c) 2026 Mohamed Mohsen Shehata. All rights reserved. See LICENSE.

import { Logger } from "@nestjs/common";

// Failure-path tests make the service log on purpose; keep test output to results.
Logger.overrideLogger(false);
