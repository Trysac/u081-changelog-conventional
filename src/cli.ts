import * as fs from "node:fs/promises";
import * as core from "./index.js";
import { assertIsoDate, assertSafePrefix, assertSafeRef } from "./validate.js";

const MAX_CHANGELOG_BYTES = 5 * 1024 * 1024;
const MAX_COMMITS = 10_000;
const MAX_NAME_LENGTH = 200;

const USAGE = [
  "usage: changelog-conventional [--file CHANGELOG.md] [--tag-prefix v]",
  "  [--from REF] [--date YYYY-MM-DD] [--dry-run] [--print-version]",
  "",
].join("\n");

/** Output sink of the CLI. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

/** Injectable dependencies of the CLI. */
export interface CliDeps {
  /** Git access; defaults to the process git in the current directory. */
  readonly git?: core.GitPort;
  /** Reads a file; reject with `code: "ENOENT"` when it does not exist. */
  readonly readFile?: (path: string) => Promise<string>;
  /** Writes a file. */
  readonly writeFile?: (path: string, content: string) => Promise<void>;
  /** Clock used for the default date. */
  readonly now?: () => Date;
}

interface Options {
  file: string;
  tagPrefix: string;
  from: string | null;
  date: string | null;
  dryRun: boolean;
  printVersion: boolean;
  help: boolean;
}

class UsageError extends Error {}

class IoFailure extends Error {}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    file: "CHANGELOG.md",
    tagPrefix: "v",
    from: null,
    date: null,
    dryRun: false,
    printVersion: false,
    help: false,
  };
  let index = 0;
  const value = (flag: string): string => {
    const next = argv[index];
    if (next === undefined) {
      throw new UsageError(`${flag} requires a value`);
    }
    index += 1;
    return next;
  };
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    index += 1;
    switch (arg) {
      case "--file":
        options.file = value(arg);
        break;
      case "--tag-prefix":
        options.tagPrefix = value(arg);
        break;
      case "--from":
        options.from = value(arg);
        break;
      case "--date":
        options.date = value(arg);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--print-version":
        options.printVersion = true;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new UsageError("unknown argument");
    }
  }
  return options;
}

function describeError(error: unknown): string {
  if (error instanceof core.ChangelogError) {
    return `error: ${error.code}: ${error.message}`;
  }
  if (error instanceof UsageError) {
    return `error: usage: ${error.message}\n${USAGE.trimEnd()}`;
  }
  if (error instanceof IoFailure) {
    return `error: io_error: ${error.message}`;
  }
  return "error: unexpected failure";
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return (error as { code?: unknown }).code === "ENOENT";
}

async function defaultReadFile(path: string): Promise<string> {
  const info = await fs.stat(path);
  if (info.size > MAX_CHANGELOG_BYTES) {
    throw new core.ChangelogError("too_large", "changelog is larger than 5 MiB");
  }
  return fs.readFile(path, "utf8");
}

async function defaultWriteFile(path: string, content: string): Promise<void> {
  await fs.writeFile(path, content, "utf8");
}

async function readExisting(
  read: (path: string) => Promise<string>,
  file: string,
): Promise<string> {
  try {
    return await read(file);
  } catch (error) {
    if (isNotFound(error)) {
      return "";
    }
    if (error instanceof core.ChangelogError) {
      throw error;
    }
    throw new IoFailure("cannot read the changelog file");
  }
}

async function execute(argv: readonly string[], io: CliIo, deps: CliDeps): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (options.from !== null) {
    assertSafeRef(options.from);
  }
  assertSafePrefix(options.tagPrefix);
  const now = deps.now ?? (() => new Date());
  const date = options.date ?? now().toISOString().slice(0, 10);
  assertIsoDate(date);

  const git = deps.git ?? core.createProcessGit(process.cwd());
  const tag = await git.latestTag(options.tagPrefix);
  const current = tag === null ? "0.0.0" : tag.slice(options.tagPrefix.length);
  const raw = await git.commitsSince(options.from ?? tag);
  if (raw.length > MAX_COMMITS) {
    throw new core.ChangelogError("too_large", "too many commits");
  }
  const commits: core.ParsedCommit[] = [];
  for (const item of raw) {
    const parsed = core.parseCommit(item);
    if (parsed !== null) {
      commits.push(parsed);
    }
  }
  const next = core.nextVersion(current, commits);
  if (next.bump === "none") {
    io.stdout("No releasable commits.\n");
    return 1;
  }
  if (options.printVersion) {
    io.stdout(`${next.version}\n`);
    return 0;
  }
  const section = core.renderRelease(next.version, date, commits);
  if (options.dryRun) {
    io.stdout(section);
    return 0;
  }
  const read = deps.readFile ?? defaultReadFile;
  const write = deps.writeFile ?? defaultWriteFile;
  const existing = await readExisting(read, options.file);
  const updated = core.updateChangelog(existing, section, next.version);
  try {
    await write(options.file, updated);
  } catch {
    throw new IoFailure("cannot write the changelog file");
  }
  const name = options.file.slice(0, MAX_NAME_LENGTH);
  io.stdout(`Wrote ${next.version} to ${name}\n`);
  return 0;
}

/**
 * Runs the CLI.
 *
 * Flags: `--file`, `--tag-prefix`, `--from`, `--date`, `--dry-run`, `--print-version`, `--help`.
 * Exit codes: 0 ok, 1 nothing releasable, 2 usage, IO, git or parse error.
 *
 * @param argv - Arguments without the executable and script names.
 * @param io - Output sink.
 * @param deps - Optional injected git port, file functions and clock.
 * @returns The process exit code.
 */
export async function run(argv: string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  try {
    return await execute(argv, io, deps);
  } catch (error) {
    io.stderr(`${describeError(error)}\n`);
    return 2;
  }
}
