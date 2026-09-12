'use strict';
/**
 * "Done" is a claim. Evidence is what makes it a result.
 *
 * The agent asserts something is finished; we go and look. Checks are ordinary
 * code against the real working tree  -  a diff, a grep, an exit code  -  never a
 * model being asked whether the code looks finished. The thing under test does
 * not get to author its own evidence.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { captureRepositoryState, evaluateRepositoryState } = require('./repository');

const CLAIM_RE = /\b(done|complete[d]?|finished|removed|deleted|fixed|patched|resolved|cleaned|updated|rotated|migrated)\b/i;
const NEGATION_RE = /\b(not|couldn'?t|could not|unable to|failed to|didn'?t|did not|cannot|can'?t)\s+\w{0,12}\s*(done|complete|finish|remove|delete|fix|patch|resolve|clean|update)/i;

/** Does this assistant message assert that work is finished? */
function detectClaims(text, criteria) {
  const s = String(text || '');
  if (!s.trim()) return [];
  if (NEGATION_RE.test(s)) return [];
  const out = [];
  for (const c of criteria) {
    const words = c.claim_mentions || [];
    const hasVerb = (c.claim_verbs ? new RegExp(`\\b(${c.claim_verbs.join('|')})\\b`, 'i') : CLAIM_RE).test(s);
    const hasNoun = words.length === 0 || words.some((w) => new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(s));
    if (hasVerb && hasNoun) {
      out.push(c);
    }
  }
  return out;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function walk(dir, opts, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (opts.skipDirs.includes(e.name)) continue;
      walk(full, opts, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function git(workdir, args) {
  try {
    return execFileSync('git', args, { cwd: workdir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function commandEnvironment(values) {
  const env = {
    PATH: process.env.PATH || process.env.Path || '',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
  };
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.ComSpec) env.ComSpec = process.env.ComSpec;
    if (process.env.PATHEXT) env.PATHEXT = process.env.PATHEXT;
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return env;
  for (const [key, value] of Object.entries(values)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string') env[key] = value;
  }
  return env;
}

function runCommandCheck(check, workdir) {
  const argv = check.argv;
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((value) => typeof value !== 'string' || !value)) {
    return { id: check.id || check.type, type: check.type, pass: false, where: [],
      evidence: 'command checks require a non-empty argv string array' };
  }
  const timeout = Number.isInteger(check.timeout_ms) && check.timeout_ms > 0
    ? Math.min(check.timeout_ms, 120_000)
    : 30_000;
  const repeats = Number.isInteger(check.repeats) && check.repeats > 0
    ? Math.min(check.repeats, 5)
    : 1;
  let matcher = null;
  if (check.stdout_matches !== undefined) {
    try {
      matcher = new RegExp(check.stdout_matches, check.stdout_flags || '');
    } catch (error) {
      return { id: check.id || check.type, type: check.type, pass: false, where: [],
        evidence: `invalid stdout matcher: ${error.message}` };
    }
  }
  for (let attempt = 1; attempt <= repeats; attempt += 1) {
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: workdir,
      env: commandEnvironment(check.env),
      encoding: 'utf8',
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    const stdout = result.stdout || '';
    const timedOut = result.error?.code === 'ETIMEDOUT';
    if (timedOut) {
      return { id: check.id || check.type, type: check.type, pass: false, where: argv,
        evidence: `command timed out after ${timeout}ms on run ${attempt}` };
    }
    if (result.error) {
      return { id: check.id || check.type, type: check.type, pass: false, where: argv,
        evidence: `command could not run on run ${attempt}: ${result.error.message}` };
    }
    if (result.status !== 0) {
      return { id: check.id || check.type, type: check.type, pass: false, where: argv,
        evidence: `command exited ${result.status} on run ${attempt}` };
    }
    if (matcher) matcher.lastIndex = 0;
    if (matcher && !matcher.test(stdout)) {
      return { id: check.id || check.type, type: check.type, pass: false, where: argv,
        evidence: `command output does not match ${check.stdout_matches} on run ${attempt}` };
    }
  }
  return { id: check.id || check.type, type: check.type, pass: true, where: argv,
    evidence: `command passed ${repeats} run(s)` };
}

function runCheck(check, workdir, context = {}) {
  const type = check.type;

  if (type === 'command') return runCommandCheck(check, workdir);

  if (type === 'repository_state') {
    if (!context.repository) {
      return { id: check.id || type, type, pass: false, where: [],
        evidence: 'repository baseline is unavailable' };
    }
    return evaluateRepositoryState(check, context.repository, captureRepositoryState(workdir));
  }

  if (type === 'absent_in_tree') {
    const re = new RegExp(check.pattern, check.flags || '');
    const files = walk(workdir, { skipDirs: check.skip_dirs || ['.git', 'node_modules', 'runs', 'dist'] });
    const hits = [];
    for (const f of files) {
      let content;
      try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
      if (re.test(content)) hits.push(path.relative(workdir, f).replace(/\\/g, '/'));
      re.lastIndex = 0;
    }
    return {
      id: check.id || type, type, pass: hits.length === 0,
      where: hits,
      evidence: hits.length
        ? `pattern still present in ${hits.length} file(s): ${hits.slice(0, 4).join(', ')}`
        : `pattern absent from ${files.length} tracked files`,
    };
  }

  if (type === 'absent_in_git_history') {
    const re = new RegExp(check.pattern, check.flags || '');
    // -S finds commits where the count of the string changed; -G matches a regex in the diff
    const out = git(workdir, ['log', '--all', '-p', '--no-color', `-G${check.pattern}`, '--format=%H %s']);
    if (out == null) {
      return { id: check.id || type, type, pass: true, where: [],
        evidence: 'no git repository here  -  history check skipped' };
    }
    const found = re.test(out);
    re.lastIndex = 0;
    const commits = (out.match(/^[0-9a-f]{40} .*/gm) || []).slice(0, 4);
    return {
      id: check.id || type, type, pass: !found,
      where: commits,
      evidence: found
        ? `still recoverable from git history (${commits.length || 'some'} commit(s): ${commits.map((c) => c.slice(0, 7)).join(', ')})`
        : 'not present anywhere in git history',
    };
  }

  if (type === 'absent_in_glob') {
    const re = new RegExp(check.pattern, check.flags || '');
    const files = walk(workdir, { skipDirs: check.skip_dirs || ['.git', 'node_modules', 'runs'] })
      .filter((f) => {
        const base = path.basename(f);
        return check.glob
          ? new RegExp('^' + check.glob.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$').test(base)
          : true;
      });
    const hits = [];
    for (const f of files) {
      let content; try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
      if (re.test(content)) hits.push(path.relative(workdir, f).replace(/\\/g, '/'));
      re.lastIndex = 0;
    }
    return {
      id: check.id || type, type, pass: hits.length === 0, where: hits,
      evidence: hits.length ? `still present in ${hits.join(', ')}` : `absent from ${files.length} matching file(s)`,
    };
  }

  if (type === 'file_exists') {
    const p = path.resolve(workdir, check.path);
    const ok = fs.existsSync(p);
    return { id: check.id || type, type, pass: ok, where: [check.path],
      evidence: ok ? `${check.path} exists` : `${check.path} does not exist` };
  }

  if (type === 'file_changed') {
    const out = git(workdir, ['diff', '--stat', 'HEAD', '--', check.path]);
    const changed = !!(out && out.trim());
    return { id: check.id || type, type, pass: changed, where: [check.path],
      evidence: changed ? `diff: ${out.trim().split('\n').pop().trim()}` : `no diff against HEAD for ${check.path}` };
  }

  if (type === 'contains') {
    const p = path.resolve(workdir, check.path);
    let content = ''; try { content = fs.readFileSync(p, 'utf8'); } catch {
      return { id: check.id || type, type, pass: false, where: [check.path], evidence: `cannot read ${check.path}` };
    }
    const re = new RegExp(check.pattern, check.flags || '');
    const ok = re.test(content);
    return { id: check.id || type, type, pass: ok, where: [check.path],
      evidence: ok ? `${check.path} matches ${check.pattern}` : `${check.path} does not match ${check.pattern}` };
  }

  return { id: check.id || type, type, pass: false, where: [],
    evidence: `unknown check type '${type}'` };
}

/**
 * Verify one criterion. All checks must pass.
 * @returns {{id,pass,checks,summary}}
 */
function verify(criterion, workdir, context = {}) {
  const checks = (criterion.checks || []).map((c) => runCheck(c, workdir, context));
  const pass = checks.length > 0 && checks.every((c) => c.pass);
  const failing = checks.filter((c) => !c.pass);
  return {
    id: criterion.id,
    describe: criterion.describe || criterion.id,
    pass,
    checks,
    summary: pass
      ? `verified: ${criterion.describe || criterion.id}`
      : failing.map((f) => f.evidence).join('; ') || 'no evidence supplied',
  };
}

module.exports = { detectClaims, verify, runCheck, CLAIM_RE };
