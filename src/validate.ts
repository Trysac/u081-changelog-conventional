import { ChangelogError } from "./errors.js";

const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isSafe(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return REF_PATTERN.test(value) && !value.includes("..");
}

function invalidDate(): ChangelogError {
  return new ChangelogError("invalid_date", "date must be YYYY-MM-DD");
}

/** Throws `invalid_ref` unless `value` is a safe git ref (never starts with `-`). */
export function assertSafeRef(value: string): void {
  if (!isSafe(value)) {
    throw new ChangelogError("invalid_ref", "ref is not a safe git ref");
  }
}

/** Throws `invalid_ref` unless `value` is empty or a safe tag prefix. */
export function assertSafePrefix(value: string): void {
  if (value !== "" && !isSafe(value)) {
    throw new ChangelogError("invalid_ref", "tag prefix is not safe");
  }
}

/** Throws `invalid_date` unless `value` is a real calendar date `YYYY-MM-DD`. */
export function assertIsoDate(value: string): void {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (match === null) {
    throw invalidDate();
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month, day);
  const monthOk = probe.getUTCMonth() === month;
  const dayOk = probe.getUTCDate() === day;
  if (year === 0 || !monthOk || !dayOk) {
    throw invalidDate();
  }
}
