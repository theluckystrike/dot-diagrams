import { expect, it } from 'vitest';
import { plan, LIGHT_PALETTE, sizeProblem } from '../src/dot';
import { layoutSvg, parseSvg, countNodes } from '../src/render';
it('rejects inherited object names as presets', () => {
 const p = plan('// preset: constructor\ndigraph { a -> b }', { pro: true, defaultEngine: 'dot', defaultPreset: '', palette: LIGHT_PALETTE });
 expect(p.preset).toBeNull();
 expect(p.notes[0]).toContain('Unknown preset');
});
it('renders 300 nodes and then reports an invalid graph', async () => {
 const raw = 'digraph { ' + Array.from({ length: 300 }, (_, i) => `n${i}`).join(' -> ') + ' }';
 expect(sizeProblem(raw, 100000, 300)).toBeNull();
 const result = await layoutSvg(raw, 'dot', raw);
 expect(result.error).toBeNull();
 expect(countNodes(parseSvg(result.svg ?? '', document)!)).toBe(300);
 const bad = 'digraph {\n a -> ;\n}';
 expect((await layoutSvg(bad, 'dot', bad)).error?.line).toBe(2);
});
