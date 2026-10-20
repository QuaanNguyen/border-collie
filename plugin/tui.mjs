import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveRoot } from './runtime-root.mjs';
import { petRpc } from './pet-rpc.mjs';

export async function startPetCompanion(context, { definition, launch } = {}) {
  if (process.env.BORDERCOLLIE_NO_PET === '1') return () => {};
  const location = context.location ?? context.data.location.default();
  if (!location?.directory) return () => {};
  const rpc = context.client.rpc(definition);
  const root = resolveRoot(path.dirname(fileURLToPath(import.meta.url)));
  if (!root) throw new Error('bordercollie cannot find its Pet runtime. Re-run scripts/install-plugin.');
  const runtime = launch ? null : await import(pathToFileURL(path.join(root, 'pet/runtime.mjs')).href);
  const launchPet = launch ?? runtime.launchPet;
  const child = launchPet(path.join(root, 'pet'));
  if (!child?.stdin) return () => {};
  let closed = false;
  const write = (event) => {
    if (!closed && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(JSON.stringify(event) + '\n');
  };
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    child.stdin.end();
    process.removeListener('beforeExit', cleanup);
    process.removeListener('exit', cleanup);
  };
  try {
    unsubscribe = rpc.events.on('event', (event) => {
      if (event.location?.directory !== location.directory || event.location.workspaceID !== location.workspaceID) return;
      write(event.data);
    });
    process.on('beforeExit', cleanup);
    process.on('exit', cleanup);
    child.once('exit', cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
  try {
    const { scale } = await rpc.configuration({}, { location, signal: AbortSignal.timeout(5000) });
    if (Number.isFinite(scale)) write({ type: 'control', detail: { action: 'size', scale } });
  } catch (error) {
    console.error('[bordercollie] Pet configuration could not be loaded:', String(error?.message || error));
  }
  return cleanup;
}

export default {
  id: 'bordercollie-pet',
  async setup(context) {
    if (process.env.BORDERCOLLIE_NO_PET === '1') return () => {};
    const { Rpc } = await import('@opencode/plugin/rpc');
    return startPetCompanion(context, { definition: Rpc.define(petRpc) });
  },
};
