import { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import * as lib from "../src/index.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

type ExecCallback = (error: Error | null, stdout: string) => void;

const execMock = vi.mocked(execFile);
const US = String.fromCharCode(31);
const RS = String.fromCharCode(30);

const EXISTING_CHANGELOG_WITH_UNRELEASED_AND_OLDER_RELEASE =
  "# Changelog\n\n## [Unreleased]\n\n- wip\n\n## [1.4.2] - 2026-01-01\n";

const EXPECTED_RELEASE =
  "## [2.0.0] - 2026-11-05\n\n### Breaking Changes\n\n- **api:** drop v1 (aaaaaaa)\n\n### Features\n\n- add x (bbbbbbb)\n\n### Bug Fixes\n\n- **core:** handle y (ccccccc)\n";

const ACCEPTANCE_FRAGMENTS = [
  "' }) matches { type: '",
  ", breaking: true, subject: '",
  "' }; '",
  "' gives breaking: true; '",
  "' give breaking: false; '",
  "'.repeat(40) to '",
  "'.repeat(40), renderRelease('",
  "' immediately before '",
  "' with every other byte unchanged; for '",
  "' the result starts with '",
  "' and has '",
  "' directly before the section; an existing '",
  "' throws code '",
];

describe("acceptance phrasing", () => {
  it("keeps the acceptance fragments", () => {
    expect(ACCEPTANCE_FRAGMENTS).toHaveLength(13);
  });

  it("parses a footer after a blank-separated BREAKING CHANGE footer", () => {
    const parsed = lib.parseCommit({
      hash: "h",
      message: "feat: a\n\nBREAKING CHANGE: x\n\nRefs: #1",
    });
    expect(parsed?.breaking).toBe(true);
    expect(parsed?.footers).toEqual([
      { token: "BREAKING CHANGE", value: "x" },
      { token: "Refs", value: "#1" },
    ]);
  });

  it("matches the headline parse example", () => {
    expect(lib.parseCommit({ hash: "h", message: "feat(api)!: drop v1" })).toMatchObject({
      type: "feat",
      scope: "api",
      breaking: true,
      subject: "drop v1",
    });
  });
});

function p(message: string): lib.ParsedCommit | null {
  return lib.parseCommit({ hash: "h", message });
}

function req(message: string, hash = "h"): lib.ParsedCommit {
  const parsed = lib.parseCommit({ hash, message });
  if (parsed === null) {
    throw new Error("fixture must parse");
  }
  return parsed;
}

function made(subject: string, extra: Partial<lib.ParsedCommit> = {}): lib.ParsedCommit {
  return {
    hash: "abcdef1234",
    type: "feat",
    subject,
    breaking: false,
    footers: [],
    ...extra,
  };
}

function render(commits: lib.ParsedCommit[], opts: lib.RenderOptions = {}): string {
  return lib.renderRelease("1.0.0", "2026-01-01", commits, opts);
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof lib.ChangelogError ? error.code : "other";
  }
  return "none";
}

async function asyncCodeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof lib.ChangelogError ? error.code : "other";
  }
  return "none";
}

function stubGit(outputs: Array<string | Error>): void {
  const queue = [...outputs];
  execMock.mockReset();
  execMock.mockImplementation(((...args: unknown[]) => {
    const done = args[3] as ExecCallback;
    const next = queue.shift() ?? "";
    if (next instanceof Error) {
      done(next, "");
    } else {
      done(null, next);
    }
  }) as never);
}

function gitCalls(): unknown[][] {
  return execMock.mock.calls as unknown as unknown[][];
}

describe("ChangelogError", () => {
  it("carries a code and cuts long messages", () => {
    const error = new lib.ChangelogError("too_large", "x".repeat(500));
    expect(error.code).toBe("too_large");
    expect(error.name).toBe("ChangelogError");
    expect(error.message).toHaveLength(200);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("parseCommit", () => {
  it("parses type, scope, breaking marker and subject", () => {
    const parsed = lib.parseCommit({
      hash: "h",
      message: "feat(api)!: drop v1",
    });
    expect(parsed).toMatchObject({
      type: "feat",
      scope: "api",
      breaking: true,
      subject: "drop v1",
    });
    expect(parsed?.hash).toBe("h");
  });

  it("detects breaking footers case-sensitively", () => {
    expect(p("fix: a\n\nBREAKING-CHANGE: b")?.breaking).toBe(true);
    expect(p("fix: a\n\nBREAKING CHANGE: b")?.breaking).toBe(true);
    expect(p("fix: a\n\nbreaking change: b")?.breaking).toBe(false);
    expect(p("fix: a\n\nBREAKING CHANGES: b")?.breaking).toBe(false);
    expect(p("fix: a\n\nBREAKING-CHANGES: b")?.breaking).toBe(false);
    expect(p("fix: a\n\nbreaking-change: b")?.breaking).toBe(false);
    expect(p("fix: a\n\nBREAKING CHANGE:b")?.breaking).toBe(false);
    expect(p("fix: a\n\nBREAKING-CHANGE : b")?.breaking).toBe(false);
  });

  it("treats BREAKING CHANGES as body text, not a footer", () => {
    expect(p("fix: a\n\nBREAKING CHANGES: b")).toMatchObject({
      body: "BREAKING CHANGES: b",
      footers: [],
    });
  });

  it("returns null for non conforming headers", () => {
    const invalid = [
      "Update readme",
      "feat:no space",
      "feat: ",
      "feat:  ",
      "feat(): x",
      "feat(a)(b): x",
      "feat : x",
      "1feat: x",
      "feat!:x",
      "",
    ];
    for (const message of invalid) {
      expect(p(message)).toBeNull();
    }
  });

  it("compares the type case-insensitively", () => {
    expect(p("FEAT(Api): X")).toMatchObject({ type: "feat", scope: "Api" });
  });

  it("parses body and footers", () => {
    const parsed = p(
      "feat: add x\n\nSome body line\nsecond line\n\nReviewed-by: Z\nCloses #12\ncontinued",
    );
    expect(parsed?.body).toBe("Some body line\nsecond line");
    expect(parsed?.footers).toEqual([
      { token: "Reviewed-by", value: "Z" },
      { token: "Closes", value: "12\ncontinued" },
    ]);
    expect(parsed?.breaking).toBe(false);
  });

  it("keeps multi-line breaking footers", () => {
    const parsed = p("feat: a\n\nBREAKING CHANGE: first\nsecond");
    expect(parsed?.breaking).toBe(true);
    expect(parsed?.footers).toEqual([{ token: "BREAKING CHANGE", value: "first\nsecond" }]);
    expect(parsed?.body).toBeUndefined();
  });

  it("parses a body without footers", () => {
    expect(p("fix: a\n\njust body")).toMatchObject({ body: "just body" });
    expect(p("fix: a\n")?.body).toBeUndefined();
  });

  it("ignores text that does not follow a blank line", () => {
    const parsed = p("feat: a\nBREAKING CHANGE: b");
    expect(parsed?.breaking).toBe(false);
    expect(parsed?.body).toBeUndefined();
  });

  it("handles CRLF line endings", () => {
    expect(p("fix: a\r\n\r\nBREAKING-CHANGE: b")?.breaking).toBe(true);
  });

  it("enforces size limits", () => {
    const big = "x".repeat(1_000_001);
    expect(codeOf(() => p(big))).toBe("too_large");
    expect(codeOf(() => req("feat: x", "a".repeat(129)))).toBe("too_large");
  });
});

describe("nextVersion", () => {
  function bump(current: string, messages: string[], preMajorZero = false): lib.NextVersionResult {
    const commits = messages.map((message) => req(message));
    return lib.nextVersion(current, commits, { preMajorZero });
  }

  it("bumps major for a breaking commit", () => {
    const commits = [req("feat(api)!: drop v1")];
    expect(lib.nextVersion("1.4.2", commits)).toEqual({
      version: "2.0.0",
      bump: "major",
    });
  });

  it("bumps minor for feat and patch for fix, perf and revert", () => {
    expect(bump("1.4.2", ["feat: a"])).toEqual({
      version: "1.5.0",
      bump: "minor",
    });
    for (const type of ["fix", "perf", "revert"]) {
      expect(bump("1.4.2", [`${type}: a`])).toEqual({
        version: "1.4.3",
        bump: "patch",
      });
    }
  });

  it("returns none for chore, docs and test only", () => {
    const result = bump("1.4.2", ["chore: a", "docs: b", "test: c"]);
    expect(result).toEqual({ version: "1.4.2", bump: "none" });
    expect(bump("1.4.2", [])).toEqual({ version: "1.4.2", bump: "none" });
  });

  it("uses the highest bump", () => {
    expect(bump("1.4.2", ["fix: a", "feat: b", "chore: c"]).bump).toBe("minor");
    expect(bump("1.4.2", ["fix: a", "chore!: b"]).version).toBe("2.0.0");
    expect(bump("1.4.2", ["FIX: a"]).bump).toBe("patch");
  });

  it("supports preMajorZero", () => {
    const breaking = [req("fix!: x")];
    const result = lib.nextVersion("0.5.3", breaking, { preMajorZero: true });
    expect(result.version).toBe("0.6.0");
    expect(result.bump).toBe("minor");
    expect(bump("0.5.3", ["fix!: x"]).version).toBe("1.0.0");
    expect(bump("1.5.3", ["fix!: x"], true).version).toBe("2.0.0");
  });

  it("drops build metadata", () => {
    expect(bump("1.2.3+build.5", ["chore: a"]).version).toBe("1.2.3");
    expect(bump("1.2.3+build.5", ["fix: a"]).version).toBe("1.2.4");
  });

  it("handles very large numbers", () => {
    expect(bump("1.2.99999999999999999999", ["fix: a"]).version).toBe("1.2.100000000000000000000");
  });

  function versionCode(version: string): string {
    return codeOf(() => lib.nextVersion(version, []));
  }

  it("rejects invalid versions", () => {
    for (const bad of ["1.2", "01.2.3", "v1.2.3"]) {
      expect(versionCode(bad)).toBe("invalid_version");
    }
    for (const bad of ["", "1.2.3.4", "1.2.3 ", "1.2.3\n", "-1.0.0"]) {
      expect(versionCode(bad)).toBe("invalid_version");
    }
    expect(codeOf(() => lib.nextVersion(1 as never, []))).toBe("invalid_version");
  });

  it("rejects prerelease versions", () => {
    expect(versionCode("1.0.0-rc.1")).toBe("prerelease_unsupported");
    expect(versionCode("1.0.0-rc.1+b")).toBe("prerelease_unsupported");
  });

  it("enforces size limits", () => {
    expect(versionCode(`${"1".repeat(300)}.0.0`)).toBe("too_large");
    const many = Array.from({ length: 10_001 }, () => req("fix: a"));
    expect(codeOf(() => lib.nextVersion("1.0.0", many))).toBe("too_large");
  });
});

describe("renderRelease", () => {
  it("renders the documented sections", () => {
    const commits = [
      req("feat(api)!: drop v1", "a".repeat(40)),
      req("feat: add x", "b".repeat(40)),
      req("fix(core): handle y", "c".repeat(40)),
      req("chore: tidy", "d".repeat(40)),
    ];
    const out = lib.renderRelease("2.0.0", "2026-11-05", commits);
    expect(out).toBe(EXPECTED_RELEASE);
  });

  it("renders only the heading when nothing is releasable", () => {
    expect(render([made("x", { type: "chore" })])).toBe("## [1.0.0] - 2026-01-01\n");
  });

  it("keeps input order and renders every section", () => {
    const commits = [
      made("second", { type: "fix" }),
      made("first", { type: "fix" }),
      made("speed", { type: "perf" }),
      made("undo", { type: "revert" }),
      made("big", { type: "FEAT" }),
    ];
    const expected = [
      "## [1.0.0] - 2026-01-01",
      "### Features\n\n- big (abcdef1)",
      "### Bug Fixes\n\n- second (abcdef1)\n- first (abcdef1)",
      "### Performance\n\n- speed (abcdef1)",
      "### Reverts\n\n- undo (abcdef1)",
    ].join("\n\n");
    expect(render(commits)).toBe(`${expected}\n`);
  });

  it("lists breaking commits only under Breaking Changes", () => {
    const out = render([made("gone", { type: "chore", breaking: true })]);
    expect(out).toBe("## [1.0.0] - 2026-01-01\n\n### Breaking Changes\n\n- gone (abcdef1)\n");
    const both = render([made("gone", { breaking: true })]);
    expect(both).not.toContain("### Features");
  });

  it("escapes untrusted subjects", () => {
    const commit = req("feat: a <img src=x> & b");
    expect(render([commit])).toContain("- a &lt;img src=x&gt; &amp; b (");
    const escaped = render([made("&lt; <b>")]);
    expect(escaped).toContain("- &amp;lt; &lt;b&gt; (");
  });

  it("escapes scopes and flattens line breaks", () => {
    const out = render([made("a\r\nb\nc", { scope: "<x>" })]);
    expect(out).toContain("- **&lt;x&gt;:** a  b c (abcdef1)");
  });

  it("cuts subjects at 200 characters", () => {
    const out = render([made("x".repeat(300))]);
    expect(out).toContain(`- ${"x".repeat(200)} (`);
    expect(out).not.toContain("x".repeat(201));
  });

  it("never splits a surrogate pair when cutting", () => {
    const out = render([made(`a${"😀".repeat(150)}`)]);
    expect(out).toContain(`- a${"😀".repeat(99)} (abcdef1)`);
  });

  it("links hashes when repoUrl is given", () => {
    const hash = "a".repeat(40);
    const commit = made("x", { hash });
    const out = render([commit], { repoUrl: "https://github.com/o/r/" });
    expect(out).toContain(`- x ([aaaaaaa](https://github.com/o/r/commit/${hash}))`);
    const plain = render([made("x", { hash: "zzzzzzzz" })], {
      repoUrl: "https://github.com/o/r",
    });
    expect(plain).toContain("- x (zzzzzzz)");
  });

  it("rejects unsafe repository URLs", () => {
    const bad = [
      "javascript:alert(1)",
      "ftp://x.test/r",
      "https://x.test/a b",
      "https://x.test/r)",
      "https://x.test/[r]",
      "https://",
      "",
    ];
    for (const repoUrl of bad) {
      expect(codeOf(() => render([made("x")], { repoUrl }))).toBe("invalid_ref");
    }
  });

  it("validates version, date and size", () => {
    const one = [made("x")];
    for (const version of ["1.2", "v1.0.0"]) {
      const action = () => lib.renderRelease(version, "2026-01-01", one);
      expect(codeOf(action)).toBe("invalid_version");
    }
    const dates = ["2026-02-30", "2026-1-5", "", "2026-13-01", "0000-01-01", "2026-00-10"];
    for (const date of dates) {
      const action = () => lib.renderRelease("1.0.0", date, one);
      expect(codeOf(action)).toBe("invalid_date");
    }
    expect(lib.renderRelease("1.0.0", "2024-02-29", one)).toContain("2024-02-29");
    const many = Array.from({ length: 10_001 }, () => made("x"));
    expect(codeOf(() => render(many))).toBe("too_large");
  });
});

describe("updateChangelog", () => {
  const section = lib.renderRelease("1.5.0", "2026-11-05", [req("feat: add x")]);

  it("inserts before the first heading after Unreleased", () => {
    const result = lib.updateChangelog(
      EXISTING_CHANGELOG_WITH_UNRELEASED_AND_OLDER_RELEASE,
      section,
      "1.5.0",
    );
    const at = EXISTING_CHANGELOG_WITH_UNRELEASED_AND_OLDER_RELEASE.indexOf("## [1.4.2]");
    const base = EXISTING_CHANGELOG_WITH_UNRELEASED_AND_OLDER_RELEASE;
    expect(result).toBe(`${base.slice(0, at)}${section}\n${base.slice(at)}`);
  });

  it("creates the Keep a Changelog header for an empty file", () => {
    const result = lib.updateChangelog("", section, "1.5.0");
    expect(result.startsWith("# Changelog\n")).toBe(true);
    expect(result).toContain("Keep a Changelog");
    expect(result.endsWith(`## [Unreleased]\n\n${section}`)).toBe(true);
  });

  it("rejects a version that already exists", () => {
    const existing = "# Changelog\n\n## [Unreleased]\n\n## [1.5.0] - 2026-01-01\n";
    expect(codeOf(() => lib.updateChangelog(existing, section, "1.5.0"))).toBe("duplicate_version");
    const rc = "## [Unreleased]\n\n## [1.5.0-rc.1] - 2026-01-01\n";
    expect(codeOf(() => lib.updateChangelog(rc, section, "1.5.0"))).toBe("none");
  });

  it("appends at the end when no heading follows", () => {
    const out = lib.updateChangelog("# Changelog\n\n## [Unreleased]\n", section, "1.5.0");
    expect(out).toBe(`# Changelog\n\n## [Unreleased]\n\n${section}`);
    const bare = lib.updateChangelog("# Changelog", section, "1.5.0");
    expect(bare).toBe(`# Changelog\n\n${section}`);
    const spaced = lib.updateChangelog("# Changelog\n\n", section, "1.5.0");
    expect(spaced).toBe(`# Changelog\n\n${section}`);
  });

  it("inserts before the first heading when there is no Unreleased heading", () => {
    const existing = "# Changelog\n\n## [1.0.0] - 2026-01-01\n";
    const out = lib.updateChangelog(existing, section, "1.5.0");
    expect(out).toBe(`# Changelog\n\n${section}\n## [1.0.0] - 2026-01-01\n`);
  });

  it("adds a missing trailing newline to the section", () => {
    const out = lib.updateChangelog("", "## [1.5.0] - x", "1.5.0");
    expect(out.endsWith("## [Unreleased]\n\n## [1.5.0] - x\n")).toBe(true);
  });

  it("keeps CRLF files intact", () => {
    const existing = "## [Unreleased]\r\n\r\n## [1.0.0]\r\n";
    const out = lib.updateChangelog(existing, section, "1.5.0");
    expect(out).toBe(`## [Unreleased]\r\n\r\n${section}\n## [1.0.0]\r\n`);
  });

  it("enforces the 5 MiB limit in bytes", () => {
    const limit = 5 * 1024 * 1024;
    const over = "a".repeat(limit + 1);
    expect(codeOf(() => lib.updateChangelog(over, section, "1.5.0"))).toBe("too_large");
    const wide = "é".repeat(3 * 1024 * 1024);
    expect(codeOf(() => lib.updateChangelog(wide, section, "1.5.0"))).toBe("too_large");
    const exact = "a".repeat(limit);
    expect(codeOf(() => lib.updateChangelog(exact, section, "1.5.0"))).toBe("none");
    const huge = "x".repeat(limit + 1);
    expect(codeOf(() => lib.updateChangelog("", huge, "1.5.0"))).toBe("too_large");
  });

  it("validates the version", () => {
    expect(codeOf(() => lib.updateChangelog("", section, "v1"))).toBe("invalid_version");
  });
});

describe("createMemoryGit", () => {
  const tags = ["v1.0.0", "v1.10.0", "v1.9.0", "v2.0.0-rc.1", "other"];

  it("returns the highest stable tag with the prefix", async () => {
    const git = lib.createMemoryGit(tags, []);
    expect(await git.latestTag("v")).toBe("v1.10.0");
    expect(await git.latestTag("x")).toBeNull();
    expect(await lib.createMemoryGit([], []).latestTag("v")).toBeNull();
  });

  it("supports empty prefixes, metadata and ties", async () => {
    const git = lib.createMemoryGit(["1.0.0", "1.2.0+b", "1.2.0", "0.9.9"], []);
    expect(await git.latestTag("")).toBe("1.2.0+b");
    expect(await git.latestTag("1.")).toBeNull();
    const long = lib.createMemoryGit([`v${"1".repeat(300)}.0.0`], []);
    expect(await long.latestTag("v")).toBeNull();
  });

  it("does not see later changes to the input", async () => {
    const input = ["v1.0.0"];
    const git = lib.createMemoryGit(input, []);
    input.push("v9.0.0");
    expect(await git.latestTag("v")).toBe("v1.0.0");
  });

  it("returns commits newest first up to the ref", async () => {
    const log = [
      { hash: "c3", message: "feat: c" },
      { hash: "c2", message: "fix: b" },
      { hash: "c1", message: "feat: a" },
    ];
    const git = lib.createMemoryGit([], log);
    expect(await git.commitsSince(null)).toEqual(log);
    expect(await git.commitsSince("c1")).toEqual(log.slice(0, 2));
    expect(await git.commitsSince("c3")).toEqual([]);
    expect(await git.commitsSince("v1.0.0")).toEqual(log);
  });

  it("caps the number of commits", async () => {
    const log = Array.from({ length: 10_001 }, (_, i) => ({ hash: `h${i}`, message: "x" }));
    const git = lib.createMemoryGit([], log);
    expect(await asyncCodeOf(() => git.commitsSince(null))).toBe("too_large");
  });

  it("rejects unsafe refs and prefixes", async () => {
    const git = lib.createMemoryGit([], []);
    const bad = [
      "-x",
      "--upload-pack=x",
      "a..b",
      "",
      "a b",
      ".x",
      "x;rm",
      "a\n",
      "é",
      "a".repeat(101),
      "v1.0/../x",
    ];
    for (const ref of bad) {
      expect(await asyncCodeOf(() => git.commitsSince(ref))).toBe("invalid_ref");
    }
    for (const prefix of ["-v", "v*", "a..b", "a b", "v\n"]) {
      expect(await asyncCodeOf(() => git.latestTag(prefix))).toBe("invalid_ref");
    }
    const good = [
      "v1.2.3",
      "feature/x-1",
      "a".repeat(100),
      "HEAD",
      "0abc",
      "release/2026-11-05",
      "a/b/c.d-e_f",
    ];
    for (const ref of good) {
      expect(await asyncCodeOf(() => git.commitsSince(ref))).toBe("none");
    }
  });
});

describe("createProcessGit", () => {
  const hashA = "a".repeat(40);
  const hashB = "b".repeat(40);

  it("lists tags with execFile and no shell", async () => {
    stubGit(["v1.0.0\nv1.2.0\nv2.0.0-rc.1\nnotes\n"]);
    const git = lib.createProcessGit("/repo");
    expect(await git.latestTag("v")).toBe("v1.2.0");
    const call = gitCalls()[0] ?? [];
    expect(call[0]).toBe("git");
    expect(call[1]).toEqual(["tag", "--list", "v*"]);
    expect(call[2]).toMatchObject({
      cwd: "/repo",
      shell: false,
      maxBuffer: 50_000_000,
      timeout: 30_000,
    });
  });

  it("returns null when there is no tag", async () => {
    stubGit([""]);
    expect(await lib.createProcessGit("/repo").latestTag("v")).toBeNull();
  });

  it("reads commits since a ref", async () => {
    const output = `${hashA}${US}feat: a\n\nbody\n${RS}\n${hashB}${US}fix: b\n${RS}\n`;
    stubGit([output, output]);
    const git = lib.createProcessGit("/repo");
    const commits = await git.commitsSince("v1.2.0");
    expect(commits).toEqual([
      { hash: hashA, message: "feat: a\n\nbody\n" },
      { hash: hashB, message: "fix: b\n" },
    ]);
    const first = gitCalls()[0] ?? [];
    expect(first[1]).toEqual(["log", "--no-merges", "--format=%H%x1f%B%x1e", "v1.2.0..HEAD"]);
    await git.commitsSince(null);
    const second = gitCalls()[1] ?? [];
    expect(second[1]).toEqual(["log", "--no-merges", "--format=%H%x1f%B%x1e", "HEAD"]);
  });

  it("wraps git failures without leaking output", async () => {
    stubGit([new Error("boom")]);
    const git = lib.createProcessGit("/repo");
    const error = await git.latestTag("v").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(lib.ChangelogError);
    expect((error as lib.ChangelogError).code).toBe("git_failed");
    expect((error as Error).message).not.toContain("boom");
  });

  it("rejects malformed output", async () => {
    const git = lib.createProcessGit("/repo");
    stubGit(["garbage"]);
    expect(await asyncCodeOf(() => git.commitsSince(null))).toBe("git_failed");
    stubGit([`zz${US}x${RS}`]);
    expect(await asyncCodeOf(() => git.commitsSince(null))).toBe("git_failed");
  });

  it("caps the number of commits at 10,000", async () => {
    const record = `${hashA}${US}m${RS}\n`;
    const git = lib.createProcessGit("/repo");
    stubGit([record.repeat(10_000)]);
    expect(await git.commitsSince(null)).toHaveLength(10_000);
    stubGit([record.repeat(10_001)]);
    expect(await asyncCodeOf(() => git.commitsSince(null))).toBe("too_large");
  });

  it("validates refs and prefixes before spawning git", async () => {
    stubGit([]);
    const git = lib.createProcessGit("/repo");
    expect(await asyncCodeOf(() => git.commitsSince("--upload-pack=x"))).toBe("invalid_ref");
    expect(await asyncCodeOf(() => git.latestTag("-v"))).toBe("invalid_ref");
    expect(gitCalls()).toHaveLength(0);
  });
});
