import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as cli from "../src/cli.js";
import * as lib from "../src/index.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

type ExecCallback = (error: Error | null, stdout: string) => void;

const execMock = vi.mocked(execFile);
const US = String.fromCharCode(31);
const RS = String.fromCharCode(30);
const LIMIT = 5 * 1024 * 1024;

const EXISTING_CHANGELOG_WITH_UNRELEASED_AND_OLDER_RELEASE =
  "# Changelog\n\n## [Unreleased]\n\n## [1.4.2] - 2026-01-01\n";

function makeIo(): { out: string[]; err: string[]; io: cli.CliIo } {
  const out: string[] = [];
  const err: string[] = [];
  const io: cli.CliIo = {
    stdout(text) {
      out.push(text);
    },
    stderr(text) {
      err.push(text);
    },
  };
  return { out, err, io };
}

function makeGit(tag: string | null, messages: string[]): { calls: string[]; port: lib.GitPort } {
  const calls: string[] = [];
  const port: lib.GitPort = {
    async latestTag(prefix) {
      calls.push(`latestTag:${prefix}`);
      return tag;
    },
    async commitsSince(ref) {
      calls.push(`commitsSince:${String(ref)}`);
      return messages.map((message, index) => {
        const hash = String((index % 9) + 1).repeat(40);
        return { hash, message };
      });
    },
  };
  return { calls, port };
}

function makeFiles(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  const deps = {
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return content;
    },
    async writeFile(path: string, content: string): Promise<void> {
      writes.push([path, content]);
      files.set(path, content);
    },
  };
  return { files, writes, deps };
}

function stubGit(outputs: string[]): void {
  const queue = [...outputs];
  execMock.mockReset();
  execMock.mockImplementation(((...args: unknown[]) => {
    const done = args[3] as ExecCallback;
    done(null, queue.shift() ?? "");
  }) as never);
}

describe("run", () => {
  it("writes the changelog and returns 0", async () => {
    const git = makeGit("v1.4.2", ["feat(api): add search", "Update readme", "fix: handle y"]);
    const files = makeFiles({
      "CHANGELOG.md": EXISTING_CHANGELOG_WITH_UNRELEASED_AND_OLDER_RELEASE,
    });
    const h = makeIo();
    const deps = { git: git.port, ...files.deps };
    const code = await cli.run(["--date", "2026-11-05"], h.io, deps);
    expect(code).toBe(0);
    expect(git.calls).toEqual(["latestTag:v", "commitsSince:v1.4.2"]);
    expect(files.writes).toHaveLength(1);
    const written = files.writes[0] ?? ["", ""];
    expect(written[0]).toBe("CHANGELOG.md");
    expect(written[1]).toContain("## [Unreleased]\n\n## [1.5.0] - 2026-11-05\n");
    expect(written[1]).toContain("- **api:** add search (1111111)");
    expect(written[1]).toContain("- handle y (3333333)");
    expect(h.out.join("")).toContain("Wrote 1.5.0 to CHANGELOG.md");
    expect(h.err).toEqual([]);
  });

  it("creates the file when it does not exist", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const files = makeFiles();
    const deps = { git: git.port, ...files.deps };
    const code = await cli.run(["--date", "2026-11-05"], makeIo().io, deps);
    expect(code).toBe(0);
    expect(files.writes[0]?.[1].startsWith("# Changelog\n")).toBe(true);
  });

  it("uses the injected clock for the default date", async () => {
    const git = makeGit("v1.4.2", ["fix: x"]);
    const files = makeFiles();
    const now = () => new Date("2026-11-05T23:59:59Z");
    const deps = { git: git.port, now, ...files.deps };
    expect(await cli.run([], makeIo().io, deps)).toBe(0);
    expect(files.writes[0]?.[1]).toContain("## [1.4.3] - 2026-11-05");
  });

  it("returns 1 when nothing is releasable", async () => {
    const git = makeGit("v1.4.2", ["chore: tidy", "docs: notes"]);
    const files = makeFiles();
    const h = makeIo();
    const deps = { git: git.port, ...files.deps };
    expect(await cli.run(["--date", "2026-11-05"], h.io, deps)).toBe(1);
    expect(files.writes).toHaveLength(0);
    expect(h.out.join("")).toContain("No releasable commits");
  });

  it("starts from 0.0.0 when there is no tag", async () => {
    const git = makeGit(null, ["feat: first"]);
    const files = makeFiles();
    const deps = { git: git.port, ...files.deps };
    expect(await cli.run(["--date", "2026-11-05"], makeIo().io, deps)).toBe(0);
    expect(git.calls).toEqual(["latestTag:v", "commitsSince:null"]);
    expect(files.writes[0]?.[1]).toContain("## [0.1.0] - 2026-11-05");
  });

  it("honours --from, --tag-prefix and --file", async () => {
    const git = makeGit("rel-2.0.0", ["feat: x"]);
    const files = makeFiles();
    const args = [
      "--from",
      "abc123",
      "--tag-prefix",
      "rel-",
      "--file",
      "docs/CHANGES.md",
      "--date",
      "2026-11-05",
    ];
    const deps = { git: git.port, ...files.deps };
    expect(await cli.run(args, makeIo().io, deps)).toBe(0);
    expect(git.calls).toEqual(["latestTag:rel-", "commitsSince:abc123"]);
    expect(files.writes[0]?.[0]).toBe("docs/CHANGES.md");
    expect(files.writes[0]?.[1]).toContain("## [2.1.0] - 2026-11-05");
  });

  it("prints the section and writes nothing with --dry-run", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const files = makeFiles();
    const h = makeIo();
    const deps = { git: git.port, ...files.deps };
    expect(await cli.run(["--dry-run", "--date", "2026-11-05"], h.io, deps)).toBe(0);
    expect(files.writes).toHaveLength(0);
    expect(h.out.join("")).toContain("## [1.5.0] - 2026-11-05");
  });

  it("prints only the version with --print-version", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const files = makeFiles();
    const h = makeIo();
    const deps = { git: git.port, ...files.deps };
    expect(await cli.run(["--print-version", "--date", "2026-11-05"], h.io, deps)).toBe(0);
    expect(h.out).toEqual(["1.5.0\n"]);
    expect(files.writes).toHaveLength(0);
    const none = makeGit("v1.4.2", ["chore: x"]);
    const again = { git: none.port, ...files.deps };
    expect(await cli.run(["--print-version"], makeIo().io, again)).toBe(1);
  });

  it("prints usage for --help", async () => {
    const h = makeIo();
    expect(await cli.run(["--help"], h.io)).toBe(0);
    expect(h.out.join("")).toContain("usage: changelog-conventional");
  });

  it("returns 2 on usage errors without touching git", async () => {
    const invalid = [["--bogus"], ["--file"], ["--date"], ["--from"], ["--tag-prefix"], ["stray"]];
    for (const args of invalid) {
      const git = makeGit("v1.4.2", ["feat: x"]);
      const h = makeIo();
      expect(await cli.run(args, h.io, { git: git.port })).toBe(2);
      expect(h.err.join("")).toContain("usage");
      expect(git.calls).toEqual([]);
    }
  });

  it("rejects option-like refs before any git call", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const files = makeFiles();
    const h = makeIo();
    const deps = { git: git.port, ...files.deps };
    const code = await cli.run(["--from", "--upload-pack=x"], h.io, deps);
    expect(code).toBe(2);
    expect(h.err.join("")).toContain("invalid_ref");
    expect(git.calls).toHaveLength(0);
    expect(files.writes).toHaveLength(0);
  });

  it("rejects unsafe tag prefixes and invalid dates", async () => {
    for (const prefix of ["-v", "a..b"]) {
      const git = makeGit("v1.4.2", ["feat: x"]);
      const h = makeIo();
      expect(await cli.run(["--tag-prefix", prefix], h.io, { git: git.port })).toBe(2);
      expect(h.err.join("")).toContain("invalid_ref");
      expect(git.calls).toHaveLength(0);
    }
    const git = makeGit("v1.4.2", ["feat: x"]);
    const h = makeIo();
    expect(await cli.run(["--date", "2026-02-30"], h.io, { git: git.port })).toBe(2);
    expect(h.err.join("")).toContain("invalid_date");
    expect(git.calls).toHaveLength(0);
  });

  it("returns 2 on git errors without leaking details", async () => {
    const failing: lib.GitPort = {
      async latestTag() {
        throw new lib.ChangelogError("git_failed", "git tag failed");
      },
      async commitsSince() {
        return [];
      },
    };
    const h = makeIo();
    expect(await cli.run([], h.io, { git: failing })).toBe(2);
    expect(h.err.join("")).toContain("git_failed");

    const broken: lib.GitPort = {
      async latestTag() {
        throw new Error("secret-token");
      },
      async commitsSince() {
        return [];
      },
    };
    const other = makeIo();
    expect(await cli.run([], other.io, { git: broken })).toBe(2);
    expect(other.err.join("")).toContain("unexpected failure");
    expect(other.err.join("")).not.toContain("secret-token");
  });

  it("returns 2 for a CHANGELOG over 5 MiB", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const files = makeFiles({ "CHANGELOG.md": "a".repeat(LIMIT + 1) });
    const h = makeIo();
    const deps = { git: git.port, ...files.deps };
    expect(await cli.run(["--date", "2026-11-05"], h.io, deps)).toBe(2);
    expect(h.err.join("")).toContain("too_large");
    expect(files.writes).toHaveLength(0);
  });

  it("returns 2 when the version already exists", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const files = makeFiles({ "CHANGELOG.md": "## [Unreleased]\n\n## [1.5.0] - 2026-01-01\n" });
    const h = makeIo();
    const deps = { git: git.port, ...files.deps };
    expect(await cli.run(["--date", "2026-11-05"], h.io, deps)).toBe(2);
    expect(h.err.join("")).toContain("duplicate_version");
  });

  it("returns 2 on file system errors", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const unreadable = {
      git: git.port,
      async readFile(): Promise<string> {
        throw new Error("EACCES");
      },
    };
    const h = makeIo();
    expect(await cli.run(["--date", "2026-11-05"], h.io, unreadable)).toBe(2);
    expect(h.err.join("")).toContain("io_error");

    const files = makeFiles();
    const unwritable = {
      git: git.port,
      readFile: files.deps.readFile,
      async writeFile(): Promise<void> {
        throw new Error("EROFS");
      },
    };
    const w = makeIo();
    expect(await cli.run(["--date", "2026-11-05"], w.io, unwritable)).toBe(2);
    expect(w.err.join("")).toContain("io_error");
  });

  it("passes through size errors raised by the file reader", async () => {
    const git = makeGit("v1.4.2", ["feat: x"]);
    const deps = {
      git: git.port,
      async readFile(): Promise<string> {
        throw new lib.ChangelogError("too_large", "too big");
      },
    };
    const h = makeIo();
    expect(await cli.run(["--date", "2026-11-05"], h.io, deps)).toBe(2);
    expect(h.err.join("")).toContain("too_large");
  });

  it("returns 2 when git returns too many commits", async () => {
    const messages = Array.from({ length: 10_001 }, () => "chore: x");
    const git = makeGit("v1.4.2", messages);
    const h = makeIo();
    expect(await cli.run([], h.io, { git: git.port })).toBe(2);
    expect(h.err.join("")).toContain("too_large");
  });

  it("uses the process git by default", async () => {
    const record = `${"a".repeat(40)}${US}feat: x\n${RS}\n`;
    stubGit(["v1.0.0\n", record]);
    const files = makeFiles();
    const h = makeIo();
    expect(await cli.run(["--date", "2026-11-05"], h.io, files.deps)).toBe(0);
    const first = (execMock.mock.calls as unknown as unknown[][])[0] ?? [];
    expect(first[0]).toBe("git");
    expect(files.writes[0]?.[1]).toContain("## [1.1.0] - 2026-11-05");
  });

  it("uses the real file system by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "changelog-conventional-"));
    try {
      const file = join(dir, "CHANGELOG.md");
      const git = makeGit("v1.4.2", ["feat: add x"]);
      const args = ["--file", file, "--date", "2026-11-05"];
      expect(await cli.run(args, makeIo().io, { git: git.port })).toBe(0);
      expect(await readFile(file, "utf8")).toContain("## [1.5.0] - 2026-11-05");

      const again = makeIo();
      expect(await cli.run(args, again.io, { git: git.port })).toBe(2);
      expect(again.err.join("")).toContain("duplicate_version");

      await writeFile(file, "a".repeat(LIMIT + 1));
      const big = makeIo();
      expect(await cli.run(args, big.io, { git: git.port })).toBe(2);
      expect(big.err.join("")).toContain("too_large");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
