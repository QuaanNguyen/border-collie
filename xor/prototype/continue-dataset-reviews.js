'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { review, reviewInstructionHash } = require('./review-v2-pilot');
const { reconcileRepair } = require('./repair-dataset');

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function finish(directory, targets, repair = false) {
  const rows = fs.readFileSync(path.join(directory, 'scenarios.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const complete = await Promise.all(targets.map(async ({ model, pid }) => {
    if (!['inkling-small', 'kimi-k2-7-code'].includes(model)) throw new Error('Only the registered independent reviewers may resume');
    if (pid) {
      for (;;) {
        try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
        await pause(5000);
      }
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const file = path.join(directory, `review-${model}.json`);
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file));
        if (saved.model !== model || saved.inputHash !== inputHash || saved.instructionHash !== reviewInstructionHash) throw new Error('Review inputs or rubric changed; preserve records and prepare a new exact-input continuation');
        if (saved.status === 'complete' && saved.completed === rows.length && saved.expected === rows.length) return true;
      }
      try {
        await review(directory, model, model === 'inkling-small' ? 6 : 3, 6);
        return true;
      } catch (error) {
        process.stdout.write(JSON.stringify({ model, status: 'incomplete', attempt: attempt + 1, error: error.message }) + '\n');
        if (!error.message.startsWith('Review incomplete')) throw error;
      }
      if (attempt < 5) await pause(Math.min(300000, 30000 * 2 ** attempt));
    }
    return false;
  }));
  if (!complete.every(Boolean)) throw new Error('Independent reviews remain incomplete; saved progress is preserved and training stays prohibited');
  if (repair) {
    const result = reconcileRepair(directory);
    process.stdout.write(JSON.stringify({ status: result.status, train: result.distinctTrain, validation: result.distinctValidation, gaps: result.gaps, solJobsAllowed: false }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ status: 'independent-reviews-complete', furtherHumanAndEvaluationChecksRequired: true, solJobsAllowed: false }) + '\n');
  }
}

if (require.main === module) {
  const [directory, mode, ...targets] = process.argv.slice(2);
  if (!directory || !['review', 'repair'].includes(mode) || targets.length !== 2) throw new Error('Usage: continue-dataset-reviews.js <directory> review|repair <model[@existing-pid]> <model[@existing-pid]>');
  finish(path.resolve(directory), targets.map((target) => {
    const [model, pid] = target.split('@');
    if (pid && !/^[1-9]\d*$/.test(pid)) throw new Error('Invalid existing review process id');
    return { model, pid: pid ? Number(pid) : null };
  }), mode === 'repair').catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}

module.exports = { finish };
