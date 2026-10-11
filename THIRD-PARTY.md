# Third-party software in main.js

main.js contains these libraries as text. No second file and no download.

| Library | Version | License | Use |
| --- | --- | --- | --- |
| [@hpcc-js/wasm-graphviz](https://github.com/hpcc-systems/hpcc-js-wasm) | 1.29.1 | Apache-2.0 | WebAssembly build of Graphviz and its JavaScript wrapper. The WASM binary is stored in the library file as compressed ASCII text. |
| [Graphviz](https://graphviz.org) | 16.1.0 | Eclipse Public License 2.0 | The layout engines (dot, neato, circo, fdp, sfdp, twopi, osage) inside the WASM build. |
| [Expat](https://libexpat.github.io) | as built into Graphviz | MIT | XML parser inside the WASM build. |

## Change to the library

`patch-graphviz.mjs` changes the library text during the build, as Apache-2.0 section 4(b) asks us to say:

1. It replaces the Emscripten method `createLazyFile`, which loads a file from a URL with `XMLHttpRequest`, with a method that throws. Graphviz never calls it.
2. It replaces one `fetch` call, which streams the WASM from a URL, with a rejected promise. That path runs only when no WASM bytes are given, and DOT Diagrams always gives them.

Each replacement must match exactly once, or the build fails. The result is a bundle with no network code in the renderer. `tests/render.test.ts` checks that the patched library has no `XMLHttpRequest` and no `fetch` call and still draws a graph.

The Apache License 2.0 is at https://www.apache.org/licenses/LICENSE-2.0 and the text ships with the npm package of the library.
