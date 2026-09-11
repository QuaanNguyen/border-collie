'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function defaultPluginsDir() {
  return path.join(os.homedir(), '.config', 'opencode', 'plugins');
}

function defaultOwnerConfigDir() {
  return path.join(os.homedir(), '.config', 'opencode', 'border-collie');
}

function researchSafePolicy() {
  return {
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
  };
}

const CUSTOM_FIELDS = ['trusted_workspace_roots', 'read_paths', 'write_paths', 'allow_commands', 'command_allowlist', 'allow_ordinary_bash', 'allow_tools', 'egress', 'done_criteria', 'deny_commands', 'protected_paths', 'read_protected_paths'];

function initialOwnerPolicy(opts) {
  if (!opts.setupPackage || opts.setupPackage === 'research-safe') return researchSafePolicy();
  if (opts.setupPackage !== 'custom') throw new Error('setup package must be Research-safe or Custom');
  const policy = { schema_version: 1, setup_package: 'custom', trusted_workspace_roots: [] };
  for (const field of CUSTOM_FIELDS) {
    if (Object.hasOwn(opts.customPolicy || {}, field)) policy[field] = opts.customPolicy[field];
  }
  return policy;
}

function ensureOwnerPolicy(ownerConfigDir, opts = {}) {
  const policyPath = path.join(ownerConfigDir, 'policy.json');
  if (!fs.existsSync(policyPath)) {
    fs.mkdirSync(ownerConfigDir, { recursive: true });
    fs.writeFileSync(policyPath, JSON.stringify(initialOwnerPolicy(opts), null, 2) + '\n');
  }
  return policyPath;
}

function migrationPreview(policyPath) {
  const target = researchSafePolicy();
  let current;
  try {
    current = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (error) {
    return {
      policyPath,
      problem: 'invalid-policy',
      reason: error.message,
    };
  }
  const missingFields = Object.keys(target).filter((field) => field !== 'schema_version' && !(field in current));
  const currentSchemaVersion = Number.isInteger(current.schema_version) ? current.schema_version : 0;
  if (currentSchemaVersion >= target.schema_version && !missingFields.length) return null;
  return {
    currentSchemaVersion,
    targetSchemaVersion: target.schema_version,
    missingFields,
    recommendedPolicy: target,
  };
}

function installEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  return env;
}

function copyTree(src, dest, { skip } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skip && skip.has(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to, { skip });
    else fs.copyFileSync(from, to);
  }
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: installEnv(),
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd),
  });
  if (result.status !== 0) {
    throw new Error(cmd + ' ' + args.join(' ') + ' failed in ' + cwd + ' (exit ' + result.status + ')');
  }
}

function electronReady(petDir) {
  const marker = path.join(petDir, 'node_modules', 'electron', 'path.txt');
  if (!fs.existsSync(marker)) return false;
  try {
    const bin = require(path.join(petDir, 'node_modules', 'electron'));
    return typeof bin === 'string' && fs.existsSync(bin);
  } catch {
    return false;
  }
}

function ensureElectron(petDir, repoRoot) {
  const electronDir = path.join(petDir, 'node_modules', 'electron');
  if (!fs.existsSync(electronDir)) {
    throw new Error('electron package missing under ' + petDir);
  }
  if (electronReady(petDir)) return;

  console.log('Downloading Electron binary…');
  try {
    run(process.execPath, [path.join(electronDir, 'install.js')], petDir);
  } catch (err) {
    console.warn(String(err.message || err));
  }
  if (electronReady(petDir)) return;

  const donor = path.join(repoRoot, 'pet', 'node_modules', 'electron');
  if (electronReady(path.join(repoRoot, 'pet'))) {
    console.log('Copying Electron binary from this clone’s pet install…');
    fs.rmSync(electronDir, { recursive: true, force: true });
    copyTree(donor, electronDir);
  }
  if (!electronReady(petDir)) {
    throw new Error(
      'Electron binary did not install. From the border-collie clone run: cd pet && npm install\n' +
      'Then re-run scripts/install-plugin.',
    );
  }
}

function installPlugin(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || path.join(__dirname, '..'));
  const pluginsDir = opts.destDir || defaultPluginsDir();
  const ownerConfigDir = opts.ownerConfigDir || defaultOwnerConfigDir();
  const packageDir = path.join(pluginsDir, 'border-collie');
  const entry = path.join(pluginsDir, 'border-collie.js');
  const skipNpm = opts.skipNpm === true;

  const srcPlugin = path.join(repoRoot, 'plugin', 'border-collie.js');
  const srcGuard = path.join(repoRoot, 'guard');
  const srcPet = path.join(repoRoot, 'pet');

  if (!fs.existsSync(srcPlugin)) throw new Error('missing ' + srcPlugin);
  if (!fs.existsSync(path.join(srcGuard, 'lib', 'session.js'))) {
    throw new Error('missing guard/lib/session.js under ' + srcGuard);
  }
  if (!fs.existsSync(path.join(srcPet, 'package.json'))) {
    throw new Error('missing pet/package.json under ' + srcPet);
  }

  const ownerPolicyPath = ensureOwnerPolicy(ownerConfigDir, opts);
  const ownerPolicyMigration = migrationPreview(ownerPolicyPath);
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  fs.copyFileSync(srcPlugin, entry);
  copyTree(srcGuard, path.join(packageDir, 'guard'));
  copyTree(srcPet, path.join(packageDir, 'pet'), {
    skip: new Set(['node_modules']),
  });

  const petDir = path.join(packageDir, 'pet');
  if (!skipNpm) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    console.log('Installing pet dependencies (includes Electron)…');
    run(npm, ['install'], petDir);
    ensureElectron(petDir, repoRoot);
  }

  return {
    repoRoot,
    pluginsDir,
    packageDir,
    dest: entry,
    petDir,
    ownerPolicyPath,
    migrationPreview: ownerPolicyMigration,
  };
}

if (require.main === module) {
  console.log('Installing Border Collie into OpenCode global plugins…');
  const { dest, packageDir, petDir, ownerPolicyPath, migrationPreview: preview } = installPlugin();
  console.log('Plugin entry:  ' + dest);
  console.log('Package:       ' + packageDir + '  (guard + pet)');
  console.log('Pet deps:      ' + petDir + '/node_modules');
  console.log('Owner policy:  ' + ownerPolicyPath);
  if (preview) {
    if (preview.problem) {
      console.log('Owner policy needs attention: ' + preview.policyPath);
      console.log('Its contents were preserved and the package was installed. Fix the JSON before updating policy.');
    } else {
      console.log('Policy migration preview: schema ' + preview.currentSchemaVersion + ' → ' + preview.targetSchemaVersion);
      if (preview.missingFields.length) console.log('Suggested fields: ' + preview.missingFields.join(', '));
      console.log('Recommended policy: ' + JSON.stringify(preview.recommendedPolicy));
    }
  }
  console.log('OpenCode loads ~/.config/opencode/plugins/*.js at startup.');
  console.log('Done. Open any project with: opencode <path>');
}

module.exports = { installPlugin, defaultPluginsDir, defaultOwnerConfigDir, electronReady };
