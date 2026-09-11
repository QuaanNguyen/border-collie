'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildNativePet } = require('./build-native-pet');

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

function copyTree(src, dest, { skip, copyFlags = 0 } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skip && skip.has(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to, { skip, copyFlags });
    else fs.copyFileSync(from, to, copyFlags);
  }
}

function filesMatch(left, right) {
  try {
    return fs.readFileSync(left).equals(fs.readFileSync(right));
  } catch {
    return false;
  }
}

function reusablePetRuntime(sourcePetDir, installedPetDir) {
  if (process.platform === 'darwin') {
    return nativePetReady(installedPetDir) && filesMatch(
      path.join(sourcePetDir, 'native', 'PetHost.swift'),
      path.join(installedPetDir, 'native', 'PetHost.swift'),
    );
  }
  if (!electronReady(installedPetDir)) return false;
  return filesMatch(
    path.join(sourcePetDir, 'package.json'),
    path.join(installedPetDir, 'package.json'),
  ) && filesMatch(
    path.join(sourcePetDir, 'package-lock.json'),
    path.join(installedPetDir, 'package-lock.json'),
  );
}

function nativePetReady(petDir) {
  const executable = path.join(petDir, 'native', 'pet-host');
  try {
    fs.accessSync(executable, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function redactDiagnostic(value) {
  return String(value || '')
    .replace(/(["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .trim()
    .slice(-4000);
}

function runCommand(cmd, args, cwd, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env || installEnv(),
    timeout: options.timeout,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd),
  });
  if (result.status !== 0) {
    const outcome = result.error?.code === 'ETIMEDOUT'
      ? 'timed out'
      : `failed with exit ${result.status}`;
    const diagnostic = capture
      ? redactDiagnostic(result.stderr?.toString() || result.stdout?.toString())
      : '';
    const location = cwd ? ' in ' + cwd : '';
    throw new Error(cmd + ' ' + args.join(' ') + ' ' + outcome + location + (diagnostic ? '\n' + diagnostic : ''));
  }
  return result;
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

function electronVersion(petDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(petDir, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

function ensureElectron(petDir, donorPetDirs = []) {
  const electronDir = path.join(petDir, 'node_modules', 'electron');
  if (!fs.existsSync(electronDir)) {
    throw new Error('electron package missing under ' + petDir);
  }
  if (electronReady(petDir)) return;

  const wantedVersion = electronVersion(petDir);
  for (const donorPetDir of donorPetDirs) {
    if (!donorPetDir || !electronReady(donorPetDir)) continue;
    if (electronVersion(donorPetDir) !== wantedVersion) continue;
    console.log('Reusing the matching Electron binary…');
    fs.rmSync(electronDir, { recursive: true, force: true });
    copyTree(path.join(donorPetDir, 'node_modules', 'electron'), electronDir);
    return;
  }

  console.log('Downloading Electron binary…');
  try {
    runCommand(process.execPath, [path.join(electronDir, 'install.js')], petDir);
  } catch (err) {
    console.warn(String(err.message || err));
  }
  if (electronReady(petDir)) return;

  if (!electronReady(petDir)) {
    throw new Error(
      'Electron binary did not install. From the border-collie clone run: cd pet && npm install\n' +
      'Then re-run scripts/install-plugin.',
    );
  }
}

function verifyStagedPlugin(entry, cwd) {
  const href = require('node:url').pathToFileURL(entry).href;
  const script = `const plugin = await import(${JSON.stringify(href)}); if (typeof plugin.BorderCollie !== 'function') process.exit(2)`;
  runCommand(process.execPath, ['--input-type=module', '-e', script], cwd, { capture: true });
}

function verifyOpenCode(cwd, ownerConfigDir) {
  const env = installEnv();
  const eventsPath = path.join(os.tmpdir(), `border-collie-install-check-${process.pid}.jsonl`);
  env.BORDER_COLLIE_NO_PET = '1';
  env.BORDER_COLLIE_EVENTS = eventsPath;
  env.BORDER_COLLIE_OWNER_CONFIG = ownerConfigDir;
  try {
    runCommand(process.platform === 'win32' ? 'opencode.exe' : 'opencode', ['debug', 'config'], cwd, {
      capture: true,
      env,
      timeout: 120000,
    });
  } finally {
    fs.rmSync(eventsPath, { force: true });
  }
}

function replaceInstallation({ stagePackage, stageEntry, packageDir, entry, pluginsDir, verify }) {
  const suffix = `${process.pid}-${Date.now()}`;
  const packageBackup = path.join(pluginsDir, `.border-collie-package-backup-${suffix}`);
  const entryBackup = path.join(pluginsDir, `.border-collie-entry-backup-${suffix}.js`);
  const hadPackage = fs.existsSync(packageDir);
  const hadEntry = fs.existsSync(entry);
  let installedPackage = false;
  let installedEntry = false;

  try {
    if (hadPackage) fs.renameSync(packageDir, packageBackup);
    fs.renameSync(stagePackage, packageDir);
    installedPackage = true;
    if (hadEntry) fs.renameSync(entry, entryBackup);
    fs.renameSync(stageEntry, entry);
    installedEntry = true;
    if (verify) verify();
  } catch (error) {
    if (installedEntry && fs.existsSync(entry)) fs.rmSync(entry, { force: true });
    if (hadEntry && fs.existsSync(entryBackup)) fs.renameSync(entryBackup, entry);
    if (installedPackage && fs.existsSync(packageDir)) {
      fs.rmSync(packageDir, { recursive: true, force: true });
    }
    if (hadPackage && fs.existsSync(packageBackup)) fs.renameSync(packageBackup, packageDir);
    throw error;
  }
  try {
    if (hadPackage) fs.rmSync(packageBackup, { recursive: true, force: true });
    if (hadEntry) fs.rmSync(entryBackup, { force: true });
  } catch {
  }
}

function installPlugin(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || path.join(__dirname, '..'));
  const pluginsDir = opts.destDir || defaultPluginsDir();
  const ownerConfigDir = opts.ownerConfigDir || defaultOwnerConfigDir();
  const packageDir = path.join(pluginsDir, 'border-collie');
  const entry = path.join(pluginsDir, 'border-collie.js');
  const skipRuntimeSetup = opts.skipRuntimeSetup === true || opts.skipNpm === true;
  const installPet = opts.installPet !== false;

  const srcPlugin = path.join(repoRoot, 'plugin', 'border-collie.js');
  const srcGuard = path.join(repoRoot, 'guard');
  const srcEvents = path.join(repoRoot, 'events');
  const srcPet = path.join(repoRoot, 'pet');

  if (!fs.existsSync(srcPlugin)) throw new Error('missing ' + srcPlugin);
  if (!fs.existsSync(path.join(srcGuard, 'lib', 'session.js'))) {
    throw new Error('missing guard/lib/session.js under ' + srcGuard);
  }
  if (!fs.existsSync(path.join(srcEvents, 'index.js'))) {
    throw new Error('missing events/index.js under ' + srcEvents);
  }
  if (installPet && !fs.existsSync(path.join(srcPet, 'package.json'))) {
    throw new Error('missing pet/package.json under ' + srcPet);
  }

  fs.mkdirSync(pluginsDir, { recursive: true });
  const stageRoot = fs.mkdtempSync(path.join(pluginsDir, '.border-collie-stage-'));
  const stagePackage = path.join(stageRoot, 'border-collie');
  const stageEntry = path.join(stageRoot, 'border-collie.js');
  const stagedPetDir = path.join(stagePackage, 'pet');
  let ownerPolicyPath;
  let ownerPolicyMigration;
  let petRuntimeReused = false;

  try {
    fs.mkdirSync(stagePackage, { recursive: true });
    fs.copyFileSync(srcPlugin, stageEntry);
    copyTree(srcGuard, path.join(stagePackage, 'guard'));
    copyTree(srcEvents, path.join(stagePackage, 'events'));
    fs.writeFileSync(path.join(stagePackage, 'install.json'), JSON.stringify({ pet: installPet }) + '\n');
    if (installPet) {
      copyTree(srcPet, stagedPetDir, {
        skip: new Set(['node_modules']),
      });
    }

    if (installPet && !skipRuntimeSetup) {
      const installedPetDir = path.join(packageDir, 'pet');
      if (reusablePetRuntime(srcPet, installedPetDir)) {
        console.log('Reusing the ready Pet runtime…');
        if (process.platform === 'darwin') {
          const source = path.join(installedPetDir, 'native', 'pet-host');
          const destination = path.join(stagedPetDir, 'native', 'pet-host');
          fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE);
          fs.chmodSync(destination, 0o755);
          petRuntimeReused = nativePetReady(stagedPetDir);
        } else {
          copyTree(
            path.join(installedPetDir, 'node_modules'),
            path.join(stagedPetDir, 'node_modules'),
            { copyFlags: fs.constants.COPYFILE_FICLONE },
          );
          petRuntimeReused = electronReady(stagedPetDir);
        }
      }
      if (!petRuntimeReused) {
        if (process.platform === 'darwin') {
          console.log('Building the native macOS Pet…');
          buildNativePet(stagedPetDir);
        } else {
          const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
          console.log('Installing locked Pet dependencies (includes Electron)…');
          runCommand(npm, ['ci', '--ignore-scripts'], stagedPetDir);
          ensureElectron(stagedPetDir, [installedPetDir, path.join(repoRoot, 'pet')]);
        }
      }
    }

    verifyStagedPlugin(stageEntry, stageRoot);
    ownerPolicyPath = ensureOwnerPolicy(ownerConfigDir, opts);
    ownerPolicyMigration = migrationPreview(ownerPolicyPath);
    replaceInstallation({
      stagePackage,
      stageEntry,
      packageDir,
      entry,
      pluginsDir,
      verify: opts.verifyOpenCode === true ? () => {
        console.log('Verifying OpenCode plugin readiness…');
        verifyOpenCode(repoRoot, ownerConfigDir);
      } : null,
    });
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }

  const petDir = installPet ? path.join(packageDir, 'pet') : null;

  return {
    repoRoot,
    pluginsDir,
    packageDir,
    dest: entry,
    petDir,
    installPet,
    petRuntimeReused,
    ownerPolicyPath,
    migrationPreview: ownerPolicyMigration,
  };
}

if (require.main === module) {
  const installPet = !process.argv.slice(2).includes('--guard-only');
  console.log('Installing Border Collie into OpenCode global plugins…');
  const { dest, packageDir, petDir, ownerPolicyPath, migrationPreview: preview } = installPlugin({ installPet, verifyOpenCode: true });
  console.log('Plugin entry:  ' + dest);
  console.log('Package:       ' + packageDir + (installPet ? '  (guard + pet)' : '  (guard only)'));
  if (petDir) console.log('Pet runtime:   ' + (process.platform === 'darwin' ? petDir + '/native/pet-host' : petDir + '/node_modules'));
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

module.exports = { installPlugin, defaultPluginsDir, defaultOwnerConfigDir, electronReady, nativePetReady, replaceInstallation };
