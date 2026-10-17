// Regenerates the Dart contract fixtures from the real server code:
//   cd functions/api && node scripts_gen_fixtures.mjs
import { writeFileSync } from 'node:fs';
import { computeFootprint, normalizeInputs } from './src/lib/footprint.js';
import { methodology } from './src/lib/footprint_factors.js';
import { SAMPLE_INPUTS } from './src/lib/footprint_fixture_inputs.js';

const dir = new URL('../../test/fixtures/', import.meta.url);
const write = (name, data) => writeFileSync(new URL(name, dir), JSON.stringify(data, null, 2) + '\n');

write('footprint_estimate.json', computeFootprint(normalizeInputs(SAMPLE_INPUTS)));
write('footprint_methodology.json', methodology());
console.log('fixtures written');
