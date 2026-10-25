import { BadRequestException, type PipeTransform } from "@nestjs/common";
import { z } from "zod";

/** Validates and narrows a request part against a schema from the shared contracts. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: "invalid_request",
        message: z.prettifyError(result.error),
      });
    }
    return result.data;
  }
}
