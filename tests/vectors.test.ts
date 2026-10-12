import { describe, expect, it } from 'vitest';
import vectors from './vectors/dot-diagrams.json';
import { plan, type PlanOptions } from '../src/dot';

describe('golden vectors (packages/spec/vectors/dot-diagrams.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [raw, opts] = c.args as [string, PlanOptions];
			expect(plan(raw, opts)).toEqual(c.expected);
		});
	}
	it('keeps every line break, so Graphviz error lines stay true', () => {
		for (const c of vectors.cases) {
			const [block, opts] = c.args as [string, PlanOptions];
			const raw = opts.fileText ?? block;
			const out = (c.expected as { source: string }).source;
			expect(out.split('\n').length).toBe(raw.split('\n').length);
		}
	});
});
