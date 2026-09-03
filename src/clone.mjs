// Resolve a CLI target: a local directory, a GitHub URL, or owner/repo shorthand.
// Remote targets are shallow-cloned into a temp dir with symlinks disabled;
// the caller must always run cleanup().
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GH_URL = /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const SHORTHAND = /^([\w.-]+)\/([\w.-]+)$/;

export function resolveTarget(target) {
  if (existsSync(target) && statSync(target).isDirectory()) {
    return { dir: target, label: target, cleanup: () => {} };
  }
  const m = GH_URL.exec(target) ?? SHORTHAND.exec(target);
  if (!m) {
    throw new Error(
      `not a directory or GitHub repo: ${target}\n` +
      "expected a local path, https://github.com/owner/repo, or owner/repo"
    );
  }
  const url = `https://github.com/${m[1]}/${m[2]}.git`;
  const dir = mkdtempSync(join(tmpdir(), "vibetoprod-"));
  try {
    execFileSync(
      "git",
      ["-c", "core.symlinks=false", "clone", "--depth", "1", "--no-tags",
       "--filter=blob:limit=512k", "--quiet", url, dir],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 120_000 }
    );
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`clone failed for ${url}: ${e.stderr?.toString().trim() || e.message}`);
  }
  return {
    dir,
    label: `${m[1]}/${m[2]}`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
