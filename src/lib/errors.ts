import type { JsonObject, JsonValue } from "./types";

export type ErrorStage =
  | "auth"
  | "input"
  | "profile"
  | "fetch-subscription"
  | "parse-subscription"
  | "template"
  | "template-render"
  | "output"
  | "internal";

export interface ErrorDetail extends JsonObject {
  stage: ErrorStage;
  code: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly stage: ErrorStage;
  readonly code: string;
  readonly detail?: JsonValue;

  constructor(options: {
    message: string;
    stage: ErrorStage;
    code: string;
    status?: number;
    detail?: JsonValue;
  }) {
    super(options.message);
    this.name = "AppError";
    this.status = options.status ?? 400;
    this.stage = options.stage;
    this.code = options.code;
    this.detail = options.detail;
  }
}

export function toErrorResponseBody(error: unknown): JsonObject {
  if (error instanceof AppError) {
    return {
      ok: false,
      error: error.message,
      error_detail: {
        stage: error.stage,
        code: error.code,
        message: error.message,
        ...(error.detail !== undefined ? { detail: error.detail } : {}),
      },
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      error: error.message,
      error_detail: {
        stage: "internal",
        code: "UNEXPECTED_ERROR",
        message: error.message,
      },
    };
  }

  return {
    ok: false,
    error: "未知错误",
    error_detail: {
      stage: "internal",
      code: "UNKNOWN_ERROR",
      message: "未知错误",
    },
  };
}
