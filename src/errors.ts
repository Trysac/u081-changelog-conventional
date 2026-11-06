/** Stable machine-readable error codes raised by this library. */
export type ChangelogErrorCode =
  | "invalid_version"
  | "prerelease_unsupported"
  | "duplicate_version"
  | "git_failed"
  | "invalid_ref"
  | "invalid_date"
  | "too_large";

const MAX_MESSAGE_LENGTH = 200;

/** Base error of the library. `code` is stable and machine readable. */
export class ChangelogError extends Error {
  /** Stable machine-readable error code. */
  readonly code: ChangelogErrorCode;

  /**
   * @param code - Stable error code.
   * @param message - Human readable message, cut to 200 characters.
   */
  constructor(code: ChangelogErrorCode, message: string) {
    super(message.slice(0, MAX_MESSAGE_LENGTH));
    this.name = "ChangelogError";
    this.code = code;
  }
}
