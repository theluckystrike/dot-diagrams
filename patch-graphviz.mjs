// Build step: removes the network code that the Graphviz WASM library carries but never runs here.
// Library: @hpcc-js/wasm-graphviz 1.29.1 (Apache-2.0), dist/index.js. This is a change to the library text (Apache-2.0 section 4b).
//   1. Emscripten createLazyFile: loads a file from a URL with XMLHttpRequest. Graphviz never calls it. The method is replaced by one that throws.
//   2. A streaming compile of the WASM from a URL with fetch. It runs only when no WASM bytes are given. We always give the bytes. The fetch becomes a rejected promise.
// Each replacement must match exactly once. A different library version makes the build fail, so no one ships an unchecked bundle.
const LAZY_START = 'createLazyFile(r,e,t,n,o){class s{';
const LAZY_END = 'c.stream_ops=y,c}';
const FETCH = 'fetch(e,{credentials:"same-origin"})';
const OFF = 'DOT Diagrams: network access is off';

function count(text, needle) {
	return text.split(needle).length - 1;
}

/** Returns the library text without its network code. Throws when the library does not look like version 1.29.1. */
export function patchGraphviz(text) {
	for (const needle of [LAZY_START, FETCH]) {
		if (count(text, needle) !== 1) throw new Error(`patch-graphviz: expected one "${needle.slice(0, 40)}", found ${count(text, needle)}. Check the @hpcc-js/wasm-graphviz version.`);
	}
	const start = text.indexOf(LAZY_START);
	const end = text.indexOf(LAZY_END, start);
	if (end < 0) throw new Error('patch-graphviz: the end of createLazyFile was not found.');
	const removed = text.slice(start, end + LAZY_END.length);
	if (count(removed, 'new XMLHttpRequest') !== 2) throw new Error('patch-graphviz: createLazyFile does not hold the two XMLHttpRequest calls that were expected.');
	const out = text.slice(0, start) + `createLazyFile(){throw new Error(${JSON.stringify(OFF)})}` + text.slice(end + LAZY_END.length);
	return out.replace(FETCH, `Promise.reject(new Error(${JSON.stringify(OFF)}))`);
}
