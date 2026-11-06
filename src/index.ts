/**
 * Public entry point of @trysac/changelog-conventional.
 *
 * Computes the next semantic version from Conventional Commits 1.0.0 messages and renders
 * Keep a Changelog sections. Git access goes through the injectable {@link GitPort}.
 */
import { execFile } from "node:child_process";
import { ChangelogError } from "./errors.js";
import { assertIsoDate, assertSafePrefix, assertSafeRef } from "./validate.js";

export type { ChangelogErrorCode } from "./errors.js";
export { ChangelogError } from "./errors.js";

const MAX_MESSAGE_LENGTH = 1_000_000;
const MAX_HASH_LENGTH = 128;
const MAX_VERSION_LENGTH = 256;
const MAX_COMMITS = 10_000;
const MAX_CHANGELOG_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200;
const GIT_MAX_BUFFER = 50_000_000;
const GIT_TIMEOUT_MS = 30_000;
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
const RECORD_SEPARATOR = String.fromCharCode(0x1e);

const TOKEN = "(BREAKING[ -]CHANGE|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)";
const HEADER_PATTERN = /^([A-Za-z]+)(?:\(([^()]+)\))?(!)?: (.+)$/;
const FOOTER_PATTERN = new RegExp(`^${TOKEN}(?:: | #)(.*)$`);
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const REPO_URL_PATTERN = /^https?:\/\/[A-Za-z0-9._~:/@%+=&-]{1,500}$/;
const HEX_PATTERN = /^[0-9a-fA-F]{7,64}$/;
const GIT_HASH_PATTERN = /^[0-9a-f]{40,64}$/;

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

const SECTION_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["feat", "Features"],
  ["fix", "Bug Fixes"],
  ["perf", "Performance"],
  ["revert", "Reverts"],
];

const CHANGELOG_HEADER = [
  "# Changelog",
  "",
  "All notable changes to this project will be documented in this file.",
  "",
  "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),",
  "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).",
  "",
  "## [Unreleased]",
  "",
  "",
].join("\n");

const UNRELEASED = "## [Unreleased]";

/** A raw commit as returned by a {@link GitPort}. */
export interface RawCommit {
  readonly hash: string;
  readonly message: string;
}

/** A Conventional Commits footer (`token: value` or `token #value`). */
export interface Footer {
  readonly token: string;
  readonly value: string;
}

/** A commit parsed according to Conventional Commits 1.0.0. */
export interface ParsedCommit {
  readonly hash: string;
  /** Lower-cased commit type, for example `feat`. */
  readonly type: string;
  readonly scope?: string;
  readonly subject: string;
  readonly body?: string;
  readonly breaking: boolean;
  readonly footers: readonly Footer[];
}

/** Kind of version increase. */
export type Bump = "major" | "minor" | "patch" | "none";

/** Options of {@link nextVersion}. */
export interface NextVersionOptions {
  /** While the major version is 0, a breaking change bumps minor instead of major. */
  readonly preMajorZero?: boolean;
}

/** Result of {@link nextVersion}. */
export interface NextVersionResult {
  readonly version: string;
  readonly bump: Bump;
}

/** Options of {@link renderRelease}. */
export interface RenderOptions {
  /** Plain http(s) repository URL; when set, commit hashes link to `URL/commit/HASH`. */
  readonly repoUrl?: string;
}

/** Injectable git access. */
export interface GitPort {
  /** Highest stable SemVer tag that starts with `prefix`, or null. */
  latestTag(prefix: string): Promise<string | null>;
  /** Non-merge commits after `ref` (newest first); all commits when `ref` is null. */
  commitsSince(ref: string | null): Promise<RawCommit[]>;
}

interface Trailer {
  readonly body: string | undefined;
  readonly footers: Footer[];
}

interface Version {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
  readonly prerelease: boolean;
}

function splitParagraphs(lines: readonly string[]): string[][] {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push(current);
  }
  return paragraphs;
}

function parseFooters(lines: readonly string[]): Footer[] {
  const footers: Array<{ token: string; value: string }> = [];
  for (const line of lines) {
    const match = FOOTER_PATTERN.exec(line);
    const previous = footers[footers.length - 1];
    if (match !== null) {
      footers.push({ token: match[1] ?? "", value: match[2] ?? "" });
    } else if (previous !== undefined) {
      previous.value = `${previous.value}\n${line}`;
    }
  }
  return footers.map((f) => ({ token: f.token, value: f.value.trim() }));
}

function parseTrailer(rest: readonly string[]): Trailer {
  const first = rest[0];
  if (first === undefined || first.trim() !== "") {
    return { body: undefined, footers: [] };
  }
  const paragraphs = splitParagraphs(rest);
  const start = paragraphs.findIndex((para) => FOOTER_PATTERN.test(para[0] ?? ""));
  let footers: Footer[] = [];
  let bodyParagraphs = paragraphs;
  if (start >= 0) {
    footers = parseFooters(paragraphs.slice(start).flat());
    bodyParagraphs = paragraphs.slice(0, start);
  }
  const body = bodyParagraphs.map((p) => p.join("\n")).join("\n\n");
  return { body: body === "" ? undefined : body, footers };
}

function isBreakingFooter(footer: Footer): boolean {
  return footer.token === "BREAKING CHANGE" || footer.token === "BREAKING-CHANGE";
}

/**
 * Parses a commit message per Conventional Commits 1.0.0.
 *
 * @param raw - Commit hash and full message.
 * @returns The parsed commit, or null when the header is not `type(scope)!: description`.
 * @throws {ChangelogError} `too_large` when the message exceeds 1,000,000 characters or the
 * hash exceeds 128 characters.
 */
export function parseCommit(raw: RawCommit): ParsedCommit | null {
  const { hash, message } = raw;
  if (message.length > MAX_MESSAGE_LENGTH || hash.length > MAX_HASH_LENGTH) {
    throw new ChangelogError("too_large", "commit is too large");
  }
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const header = HEADER_PATTERN.exec(lines[0] ?? "");
  if (header === null) {
    return null;
  }
  const scope = header[2]?.trim();
  const subject = (header[4] ?? "").trim();
  if (subject === "" || scope === "") {
    return null;
  }
  const { body, footers } = parseTrailer(lines.slice(1));
  const breaking = header[3] === "!" || footers.some(isBreakingFooter);
  return {
    hash,
    type: (header[1] ?? "").toLowerCase(),
    ...(scope === undefined ? {} : { scope }),
    subject,
    ...(body === undefined ? {} : { body }),
    breaking,
    footers,
  };
}

function matchVersion(input: string): Version | null {
  if (input.length > MAX_VERSION_LENGTH) {
    return null;
  }
  const match = SEMVER_PATTERN.exec(input);
  if (match === null) {
    return null;
  }
  return {
    major: BigInt(match[1] ?? "0"),
    minor: BigInt(match[2] ?? "0"),
    patch: BigInt(match[3] ?? "0"),
    prerelease: match[4] !== undefined,
  };
}

function requireVersion(input: string): Version {
  if (typeof input === "string" && input.length > MAX_VERSION_LENGTH) {
    throw new ChangelogError("too_large", "version is too long");
  }
  const version = typeof input === "string" ? matchVersion(input) : null;
  if (version === null) {
    throw new ChangelogError("invalid_version", "not a SemVer 2.0.0 version");
  }
  return version;
}

function assertCommitCount(count: number): void {
  if (count > MAX_COMMITS) {
    throw new ChangelogError("too_large", "too many commits");
  }
}

const PATCH_TYPES = new Set(["fix", "perf", "revert"]);

function rank(commit: ParsedCommit): number {
  if (commit.breaking) {
    return 3;
  }
  const type = commit.type.toLowerCase();
  if (type === "feat") {
    return 2;
  }
  return PATCH_TYPES.has(type) ? 1 : 0;
}

function bumpFor(commits: readonly ParsedCommit[], preMajorZero: boolean): Bump {
  let highest = 0;
  for (const commit of commits) {
    highest = Math.max(highest, rank(commit));
  }
  if (highest === 3) {
    return preMajorZero ? "minor" : "major";
  }
  if (highest === 2) {
    return "minor";
  }
  return highest === 1 ? "patch" : "none";
}

/**
 * Computes the next version from the current version and the commits since it.
 *
 * Rules: breaking changes bump major, `feat` minor, `fix`, `perf` and `revert` patch. With
 * `preMajorZero` and major 0, a breaking change bumps minor. Build metadata is dropped.
 *
 * @throws {ChangelogError} `invalid_version`, `prerelease_unsupported` or `too_large`.
 */
export function nextVersion(
  current: string,
  commits: readonly ParsedCommit[],
  opts: NextVersionOptions = {},
): NextVersionResult {
  const parsed = requireVersion(current);
  if (parsed.prerelease) {
    throw new ChangelogError("prerelease_unsupported", "prerelease versions are not supported");
  }
  assertCommitCount(commits.length);
  const preMajorZero = parsed.major === 0n && opts.preMajorZero === true;
  const bump = bumpFor(commits, preMajorZero);
  const { major, minor, patch } = parsed;
  if (bump === "major") {
    return { version: `${major + 1n}.0.0`, bump };
  }
  if (bump === "minor") {
    return { version: `${major}.${minor + 1n}.0`, bump };
  }
  if (bump === "patch") {
    return { version: `${major}.${minor}.${patch + 1n}`, bump };
  }
  return { version: `${major}.${minor}.${patch}`, bump };
}

function sanitize(text: string): string {
  let flat = text.replace(/[\r\n]/g, " ");
  if (flat.length > MAX_TEXT_LENGTH) {
    flat = flat.slice(0, MAX_TEXT_LENGTH);
    const last = flat.charCodeAt(flat.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      flat = flat.slice(0, -1);
    }
  }
  return flat.replace(/[&<>]/g, (ch) => ENTITIES[ch] ?? ch);
}

function normalizeRepoUrl(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }
  if (!REPO_URL_PATTERN.test(url)) {
    throw new ChangelogError("invalid_ref", "repoUrl must be a plain http(s) URL");
  }
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") {
    end -= 1;
  }
  return url.slice(0, end);
}

function matchesType(commit: ParsedCommit, type: string): boolean {
  return !commit.breaking && commit.type.toLowerCase() === type;
}

function groupCommits(commits: readonly ParsedCommit[]): Array<[string, ParsedCommit[]]> {
  const groups: Array<[string, ParsedCommit[]]> = [
    ["Breaking Changes", commits.filter((c) => c.breaking)],
  ];
  for (const [type, title] of SECTION_TYPES) {
    const members = commits.filter((c) => matchesType(c, type));
    groups.push([title, members]);
  }
  return groups;
}

function renderLine(commit: ParsedCommit, repoUrl: string | null): string {
  let prefix = "";
  if (commit.scope !== undefined) {
    prefix = `**${sanitize(commit.scope)}:** `;
  }
  const short = sanitize(commit.hash.slice(0, 7));
  const linked = repoUrl !== null && HEX_PATTERN.test(commit.hash);
  const ref = linked ? `[${short}](${repoUrl}/commit/${commit.hash})` : short;
  return `- ${prefix}${sanitize(commit.subject)} (${ref})`;
}

/**
 * Renders a Keep a Changelog section for a release.
 *
 * Sections: Breaking Changes, Features, Bug Fixes, Performance, Reverts. Empty sections are
 * omitted, input order is kept, other commit types are dropped. Untrusted text is escaped
 * (`&`, `<`, `>`), flattened to one line and cut at 200 characters.
 *
 * @throws {ChangelogError} `invalid_version`, `invalid_date`, `invalid_ref` (bad `repoUrl`)
 * or `too_large`.
 */
export function renderRelease(
  version: string,
  date: string,
  commits: readonly ParsedCommit[],
  opts: RenderOptions = {},
): string {
  requireVersion(version);
  assertIsoDate(date);
  assertCommitCount(commits.length);
  const repoUrl = normalizeRepoUrl(opts.repoUrl);
  const sections: string[] = [];
  for (const [title, members] of groupCommits(commits)) {
    if (members.length > 0) {
      const lines = members.map((c) => renderLine(c, repoUrl));
      sections.push(`### ${title}\n\n${lines.join("\n")}`);
    }
  }
  const head = `## [${version}] - ${date}`;
  return `${[head, ...sections].join("\n\n")}\n`;
}

interface Heading {
  readonly offset: number;
  readonly text: string;
}

function findHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  while (offset <= content.length) {
    const newline = content.indexOf("\n", offset);
    const end = newline === -1 ? content.length : newline;
    if (content.startsWith("## [", offset)) {
      headings.push({ offset, text: content.slice(offset, end) });
    }
    if (newline === -1) {
      break;
    }
    offset = newline + 1;
  }
  return headings;
}

function separatorFor(content: string): string {
  if (content.endsWith("\n\n")) {
    return "";
  }
  return content.endsWith("\n") ? "\n" : "\n\n";
}

/**
 * Inserts a release section into a changelog.
 *
 * The section goes before the first `## [` heading after `## [Unreleased]` (or before the first
 * heading when there is no Unreleased heading), otherwise at the end. Every other byte is left
 * unchanged. An empty file gets the Keep a Changelog 1.1.0 header.
 *
 * @throws {ChangelogError} `too_large` (changelog or section over 5 MiB), `invalid_version`
 * or `duplicate_version`.
 */
export function updateChangelog(
  existingChangelog: string,
  releaseSection: string,
  version: string,
): string {
  requireVersion(version);
  const text = releaseSection.endsWith("\n") ? releaseSection : `${releaseSection}\n`;
  if (Buffer.byteLength(existingChangelog, "utf8") > MAX_CHANGELOG_BYTES) {
    throw new ChangelogError("too_large", "changelog is larger than 5 MiB");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_CHANGELOG_BYTES) {
    throw new ChangelogError("too_large", "release section is larger than 5 MiB");
  }
  if (existingChangelog === "") {
    return `${CHANGELOG_HEADER}${text}`;
  }
  const headings = findHeadings(existingChangelog);
  const marker = `## [${version}]`;
  if (headings.some((h) => h.text.startsWith(marker))) {
    throw new ChangelogError("duplicate_version", "version already in changelog");
  }
  const unreleased = headings.findIndex((h) => h.text.startsWith(UNRELEASED));
  const next = unreleased === -1 ? headings[0] : headings[unreleased + 1];
  if (next !== undefined) {
    const before = existingChangelog.slice(0, next.offset);
    const after = existingChangelog.slice(next.offset);
    return `${before}${text}\n${after}`;
  }
  return `${existingChangelog}${separatorFor(existingChangelog)}${text}`;
}

function compareBig(a: bigint, b: bigint): number {
  if (a === b) {
    return 0;
  }
  return a > b ? 1 : -1;
}

function compareVersions(a: Version, b: Version): number {
  const major = compareBig(a.major, b.major);
  if (major !== 0) {
    return major;
  }
  const minor = compareBig(a.minor, b.minor);
  if (minor !== 0) {
    return minor;
  }
  return compareBig(a.patch, b.patch);
}

function pickLatestTag(prefix: string, tags: string[]): string | null {
  let best: string | null = null;
  let bestVersion: Version | null = null;
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) {
      continue;
    }
    const version = matchVersion(tag.slice(prefix.length));
    if (version === null || version.prerelease) {
      continue;
    }
    if (bestVersion === null || compareVersions(version, bestVersion) > 0) {
      best = tag;
      bestVersion = version;
    }
  }
  return best;
}

/**
 * Creates an in-memory git port for tests and dry runs.
 *
 * `commits` is newest first. `commitsSince(ref)` returns the commits before the commit whose
 * hash equals `ref`, or all commits when no hash matches.
 */
export function createMemoryGit(tags: string[], log: RawCommit[]): GitPort {
  const knownTags = [...tags];
  const knownCommits = log.map((c) => ({ hash: c.hash, message: c.message }));
  return {
    async latestTag(prefix) {
      assertSafePrefix(prefix);
      return pickLatestTag(prefix, knownTags);
    },
    async commitsSince(ref) {
      if (ref !== null) {
        assertSafeRef(ref);
      }
      const stop = ref === null ? -1 : knownCommits.findIndex((c) => c.hash === ref);
      const selected = stop === -1 ? knownCommits : knownCommits.slice(0, stop);
      assertCommitCount(selected.length);
      return selected.map((c) => ({ hash: c.hash, message: c.message }));
    },
  };
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      cwd,
      shell: false,
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8" as const,
      windowsHide: true,
    };
    execFile("git", args, options, (error: Error | null, stdout: string) => {
      if (error !== null) {
        reject(new ChangelogError("git_failed", `git ${args[0] ?? ""} failed`));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseGitLog(stdout: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    const entry = record.replace(/^\n+/, "");
    if (entry.trim() === "") {
      continue;
    }
    const split = entry.indexOf(UNIT_SEPARATOR);
    const hash = entry.slice(0, split);
    if (split === -1 || !GIT_HASH_PATTERN.test(hash)) {
      throw new ChangelogError("git_failed", "unexpected git output");
    }
    commits.push({ hash, message: entry.slice(split + 1) });
    assertCommitCount(commits.length);
  }
  return commits;
}

/**
 * Creates a git port that runs the `git` binary in `cwd` with `execFile` (no shell).
 *
 * Refs and tag prefixes are validated first, so no value can start with `-`. At most 10,000
 * commits are returned (`too_large`); git failures raise `git_failed`.
 */
export function createProcessGit(cwd: string): GitPort {
  return {
    async latestTag(prefix) {
      assertSafePrefix(prefix);
      const output = await runGit(cwd, ["tag", "--list", `${prefix}*`]);
      const tags = output.split("\n").map((line) => line.trim());
      return pickLatestTag(prefix, tags);
    },
    async commitsSince(ref) {
      if (ref !== null) {
        assertSafeRef(ref);
      }
      const range = ref === null ? "HEAD" : `${ref}..HEAD`;
      const format = "--format=%H%x1f%B%x1e";
      const output = await runGit(cwd, ["log", "--no-merges", format, range]);
      return parseGitLog(output);
    },
  };
}
