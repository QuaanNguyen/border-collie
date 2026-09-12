'use strict'

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-subagent-policy-'))
  const owner = path.join(workspace, 'owner')
  const project = path.join(workspace, 'project')
  const outside = path.join(workspace, 'outside.txt')
  fs.mkdirSync(owner)
  fs.mkdirSync(project)
  fs.writeFileSync(outside, 'outside\n')
  fs.writeFileSync(path.join(owner, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
  }))

  const keys = ['BORDER_COLLIE_NO_PET', 'BORDER_COLLIE_OWNER_CONFIG', 'BORDER_COLLIE_EVENTS']
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  process.env.BORDER_COLLIE_NO_PET = '1'
  process.env.BORDER_COLLIE_OWNER_CONFIG = owner
  process.env.BORDER_COLLIE_EVENTS = path.join(workspace, 'events.jsonl')

  try {
    const { BorderCollie } = await import(path.join(ROOT, 'plugin', 'border-collie.js'))
    const hooks = await BorderCollie({ client: {}, directory: project })
    const before = hooks['tool.execute.before']

    await assert.rejects(
      before(
        { tool: 'task', sessionID: 'parent-session' },
        { args: { subagent_type: 'explore', prompt: 'Inspect the project' } },
      ),
      (error) => {
        assert.match(error.message, /Guard refused this action/)
        assert.match(error.message, /Requested action: task/)
        assert.match(error.message, /Governing rule: allow_tools/)
        assert.match(error.message, /Permitted alternative:/)
        assert.match(error.message, /Retry:/)
        return true
      },
    )

    await before(
      { tool: 'read', sessionID: 'child-session' },
      { args: { path: path.join(project, 'README.md') } },
    )

    await assert.rejects(
      before(
        { tool: 'read', sessionID: 'child-session' },
        { args: { path: outside } },
      ),
      (error) => {
        assert.match(error.message, /Guard refused this action/)
        assert.match(error.message, /Governing rule: read_paths/)
        assert.match(error.message, /Policy layer: resolved Border Collie policy/)
        assert.match(error.message, /Permitted alternative:/)
        assert.match(error.message, /Retry:/)
        return true
      },
    )

    process.stdout.write('ok - subagent dispatch fails closed and child-session calls use the resolved policy\n')
  } finally {
    process.emit('beforeExit')
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(workspace, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
