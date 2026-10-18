# DOT Diagrams

DOT Diagrams draws Graphviz DOT code blocks as diagrams inside your notes. It draws offline, with no server and no installed Graphviz program. The layout engine is inside the plugin as WebAssembly, so your graph never leaves your device.

You write a block with the language `dot` or `graphviz`. DOT Diagrams draws the graph as an SVG in reading view and in Live Preview. The colors follow your theme. If the graph has a mistake, the block shows the line number and the message.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/dot-diagrams.gif" alt="A note with a dot block drawn as a diagram, then a layout with the neato engine, then a block with a syntax error, then a Pro note whose nodes open other notes" width="720">

## Features

### Diagrams in the note

A `dot` or `graphviz` block draws as an SVG, and draws again when you edit it. In Live Preview the block shows the diagram until you move the cursor into it. Buttons appear when you hover over a diagram. "Copy" puts the SVG on the clipboard in light colors on white, so you can paste it into a slide.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/render.png" alt="A note with a left-to-right diagram of a checkout service, drawn from a dot block" width="720">

### Colors that follow your theme

The plugin reads the text, line and fill colors of the current theme and gives them to Graphviz as defaults, on a transparent background. When you change the theme, the open diagrams draw again. Colors that you set in the DOT source, such as `color=red`, win over the defaults.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/theme.png" alt="The same checkout diagram on a light theme" width="720">

### Error messages with the line number

When Graphviz cannot read the block, DOT Diagrams draws nothing and shows a red box with the line number, the message from Graphviz and the text of that line. The line number is the line of your block, because the plugin adds its defaults on the line of the opening brace.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/error.png" alt="A red box that says DOT diagram error on line 3, syntax error near a semicolon, and shows the line b -> ;" width="720">

### Three layout engines

The default engine is `dot`, which draws layers. Write a comment on its own line to pick another one: `// engine: neato` draws a spring layout and `// engine: circo` draws a circle layout. Both are free.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/engines.png" alt="Two diagrams of the same kind of network, one drawn with neato and one drawn with circo" width="720">

### Diagrams from a DOT file

Name a `.dot` or `.gv` file of your vault in a block, and the block draws it, and draws it again when the file changes. It is free.

```dot
// file: graphs/build.dot
```

The path starts at the vault root. A bare name or a link such as `[[build.dot]]` finds the file the way a link does. Put only comment lines in that block, such as `// engine:` and `// preset:` lines, which win over the file's own. A block with its own graph ignores the line. A Graphviz error names the file and the line in it.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/file.png" alt="A note in reading view with the call graph that the plugin drew from the vault file call-graph.dot" width="720">

### Notes that open from nodes (Pro)

With Pro, a node that is a wikilink opens its note when you select it. Hold Ctrl (Cmd on macOS) to open it in a new tab. Three forms work: a quoted node id, such as `"[[Architecture]]"` or `"[[Notes/Plan|Plan]]"`, a link in the URL attribute such as `URL="[[Architecture]]"`, and a link in a label such as `label="Read [[Syntax error]]"`. The node shows the note name or the alias, and it gets the `node [...]` defaults of the graph, such as `node [shape=box]`. A label or URL that you set on the node wins. Without Pro, the same nodes show the name as plain text.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/links.png" alt="A project map where each node is the name of a note, shown with a pointer on one node" width="720">

### Export to SVG and PNG (Pro)

With Pro, the second and third buttons, or the commands "Export the diagram at the cursor to SVG" and "Export the diagram at the cursor to PNG", save the diagram in the attachment folder of the note. The file is light on white and has no note links.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/export.png" alt="An exported SVG file of the checkout diagram, open in Obsidian" width="720">

### More engines and style presets (Pro)

With Pro, `fdp`, `sfdp`, `twopi` and `osage` also work. A comment such as `// preset: blueprint` styles one block. The presets are `clean`, `blueprint`, `mono`, `pastel` and `contrast`. A preset sets its own colors, so it does not follow the theme.

<img src="https://raw.githubusercontent.com/theluckystrike/dot-diagrams/HEAD/docs/presets.png" alt="A blueprint-style diagram and a pastel twopi diagram" width="720">

## Install

1. Open "Settings → Community plugins" and turn off restricted mode.
2. Select "Browse", search for "DOT Diagrams", then "Install" and "Enable".

To install by hand, copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/dot-diagrams/` and enable the plugin. You need Obsidian 1.13.4 or later.

## Usage

1. Write a fenced block in a note and give it the language `dot` or `graphviz`.
2. Write a graph in the DOT language, for example `digraph { a -> b -> c; a -> d }`.
3. Switch to reading view, or move the cursor out of the block in Live Preview.

The first diagram must wait for the engine.

Comment lines set options for one block. Put them on their own lines, anywhere in the block:

- `// engine: neato` chooses the layout engine.
- `// preset: blueprint` chooses a style preset (Pro).
- `// file: graphs/build.dot` draws a .dot or .gv file of the vault.

You can also use `#` or `/* engine: circo */`. The first directive of each kind wins. An unknown name uses the default and shows a message.

## Settings

| Setting | What it does |
| --- | --- |
| Default layout engine | The engine for blocks without an `// engine:` line. Default `dot`. fdp, sfdp, twopi and osage need Pro. |
| Default style preset | Pro. The preset for blocks without a `// preset:` line. Empty means the theme colors. |
| Show buttons above diagrams | Shows the Copy, Export SVG and Export PNG buttons on hover. On by default. |
| Edge limit | A block with more edges is not drawn. From 50 to 20,000, default 300. |
| PNG export scale | Pro. 1 to 4 times the size at 96 dpi, default 2. |

The settings tab also has the Pro section: sign in, the status line and Refresh.

## FAQ

### Does my graph leave my device?

No. The renderer is a WebAssembly build of Graphviz inside `main.js`, and a diagram draws on your device with no request. DOT Diagrams also removes `<script>` elements, event handlers, remote images and `javascript:` links from the SVG.

### Can I use `![[graph.dot]]` instead?

Not yet. Obsidian gives plugins no public way to draw that embed in Live Preview. Use a block with a `// file:` line.

### Why not use Mermaid?

Mermaid is a different language and is built into Obsidian. Use DOT Diagrams when you have DOT, or when another tool gives you DOT, such as a call graph.

### How is this different from the Kroki plugin?

The Kroki plugin sends your block to a Kroki server, so it needs a network or a server that you run. DOT Diagrams draws on your device.

### How big is the plugin, and how fast is it?

The plugin file `main.js` is about 0.86 MB, and about 0.82 MB of it is the Graphviz engine. Layout runs on the main thread, and its cost grows fast with tangled graphs. So a block with more than 300 edges is not drawn until you raise the limit. Copy and export use the same edge limit. The fixed text limit is 300,000 characters.

### Is the code readable?

`main.js` is one minified file, like most plugins. The engine is the distribution file of the Apache-2.0 library @hpcc-js/wasm-graphviz 1.29.1, with two changes that remove its unused network code. The WebAssembly binary sits inside it as compressed ASCII text. `THIRD-PARTY.md` lists the licenses and the changes.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, DOT Diagrams makes no network requests. Sign in uses the GitHub device flow. DOT Diagrams sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, DOT Diagrams sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report bugs and ask for features in the GitHub issues of this repository, with your Obsidian version and the DOT text of the block. To support the work, use [GitHub Sponsors](https://github.com/sponsors/theluckystrike).
