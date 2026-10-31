import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [left, right] = process.argv.slice(2);
if (!left || !right) throw new Error('Usage: node compare.mjs BASELINE.json CANDIDATE.json');
const baseline = JSON.parse(await readFile(left, 'utf8')),
  candidate = JSON.parse(await readFile(right, 'utf8'));
for (const field of ['sha256', 'rootLength', 'seed', 'copies']) {
  assert.notEqual(baseline.corpus[field], undefined, `Baseline lacks corpus.${field}`);
  assert.deepEqual(
    candidate.corpus[field],
    baseline.corpus[field],
    `Different corpus.${field}; results are not directly comparable`,
  );
}
assert.equal(candidate.fidelity.degreeSequencesMatch, true);
assert.equal(candidate.policy.samples, baseline.policy.samples, 'Different sample counts');
assert.deepEqual(
  Object.keys(candidate.operations),
  Object.keys(baseline.operations),
  'Different workload set',
);
for (const [name, result] of Object.entries(baseline.operations)) {
  assert.deepEqual(
    candidate.operations[name].returned,
    result.returned,
    `Different returned counts for ${name}; inspect correctness before comparing speed`,
  );
}
for (const field of ['entities', 'canonicalEdges', 'populatedTypes', 'typedRelationGroups'])
  assert.equal(
    candidate.fidelity[field],
    baseline.fidelity[field],
    `Logical result mismatch: ${field}`,
  );
const change = (before, after) => `${((after / before - 1) * 100).toFixed(1)}%`;
console.log('| Metric | Baseline | Candidate | Change |\n| --- | ---: | ---: | ---: |');
for (const field of ['initialBuildMs', 'changedRefreshMs'])
  console.log(
    `| ${field} | ${baseline[field].toFixed(2)} | ${candidate[field].toFixed(2)} | ${change(baseline[field], candidate[field])} |`,
  );
console.log(
  `| databaseBytes | ${baseline.storage.databaseBytes} | ${candidate.storage.databaseBytes} | ${change(baseline.storage.databaseBytes, candidate.storage.databaseBytes)} |`,
);
for (const [name, result] of Object.entries(baseline.operations)) {
  if (!candidate.operations[name]) continue;
  for (const quantile of ['median', 'p95']) {
    const before = result.milliseconds[quantile],
      after = candidate.operations[name].milliseconds[quantile];
    console.log(
      `| ${name} ${quantile} ms | ${before.toFixed(3)} | ${after.toFixed(3)} | ${change(before, after)} |`,
    );
  }
}
if (JSON.stringify(baseline.environment) !== JSON.stringify(candidate.environment))
  console.error(
    'Environment differs; interpret timings accordingly. Percent changes are descriptive, not significance tests.',
  );
