# Agent Note: The Command Deck survives a browser without WebGL and a scene that throws

Status: implemented

English | [中文](2026-09-29-command-deck-room-grade.zh.md)

## Problem

The Command Deck is shown to clients from a public link. Every one of its views draws its stage with three.js, and three r169 creates only WebGL 2 contexts. Corporate laptops, remote desktop sessions and hardened browsers often offer no WebGL at all. On such a machine `WebGLRenderer` throws from the canvas's layout effect, nothing in the deck caught it, and Next.js replaced the whole page, header and panel included, with its unbranded "Application error" screen. The same happened for any runtime error inside a scene, because react-three-fiber rethrows every scene error into the React tree. A client who opened the link on a locked-down laptop saw a dead page.

## Decision

**Every stage mounts behind one gate.** `components/three/WebGLGate.tsx` exports `WebGLGate`, which each view wraps around its dynamically imported stage. On the first client render the gate asks a scratch canvas for a `webgl2` context, releases it, and remembers the answer for the page load. Without a context the scene, and the three.js chunk it would load, never mount: the stage shows the view's still from `public/posters/<view>.jpg`, resolved under `NEXT_PUBLIC_BASE_PATH`, under a note that the panel has the full record. The panel, the header and every tab keep working, because nothing outside the stage depends on the canvas.

**The gate is also the stage's error boundary.** `SceneBoundary`, a class component, holds any error a stage throws after mounting to the stage: the view shows the same still with the error's message and a button that mounts the scene again. `Stage` raises a lost WebGL context as such an error, since a context the browser takes back leaves a black canvas that three.js does not restore by itself; the listener ignores the loss react-three-fiber forces half a second after an ordinary unmount.

**Errors outside a stage keep the shell.** `app/error.tsx` renders the deck's own error screen (`components/shell/DeckError.tsx`) in place of a view that throws, inside the root layout, so the header, navigation and footer stay. `app/global-error.tsx` renders the same screen under a header of its own, with plain links to every view, when the shell itself throws.

**The posters are stills of the real scenes.** Each is the stage alone, captured from the static export at 1600×900 over the committed fixtures with the overlay copy hidden, so the view's own title does not appear twice. They are JPEG files of under 100 KB each, because the scenes' film grain and bloom make a PNG of the same frame many times larger.

**One mechanism for every view.** The [Operations view](2026-09-28-operations-center.md) shipped its own probe, boundary and context watch around a floor drawn flat as SVG; they are folded into the gate, which takes either a still (`poster`) or a drawing the view makes from its own data (`flat`), and `/ops` passes its flat floor. `?flat` on the address, which the Operations view introduced, now asks every stage for its stand-in, so a presenter can rehearse the fallback on a machine that has WebGL.

## Alternatives considered

**A 2D rendering of each scene.** A canvas-2D or SVG version of the graph, the pipeline, the city and the workflow would keep the views interactive without WebGL, at the cost of a second renderer per view that has to stay in step with the first. The panel already holds every fact the scenes show, so a still plus the panel meets the need at a fraction of the cost.

**Let `app/error.tsx` catch scene failures.** Without the gate's boundary a scene that throws reaches the route's error boundary, which replaces the whole view and takes the panel with it. Holding the failure to the stage keeps the record readable, and `app/error.tsx` remains the backstop for failures outside a stage.

**Probe for WebGL on the server, or render the poster before the probe answers.** The server cannot know the viewer's browser, and drawing the poster first would flash it under every scene that then mounts. The gate draws nothing for the one frame the probe takes.

**PNG posters.** The scenes carry film grain and bloom, which PNG compresses poorly; four PNG stills at the stage's size cost several megabytes on exactly the constrained machines that need them.

## Consequences

The public link opens on a working deck in any browser: without WebGL each view is a still of its scene beside a fully working panel, and a scene failure costs the scene only. The stills show the committed fixtures at rest, not the run being followed, and answer no click; the note on the stage says the panel is the record. The posters must be re-captured when a scene's look changes, or they will show an older deck than the live one.
