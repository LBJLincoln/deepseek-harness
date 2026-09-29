# Agent Note: The Command Deck survives a browser without WebGL, presents without a keyboard and names runs for people

Status: implemented

English | [中文](2026-09-29-command-deck-room-grade.zh.md)

## Problem

The Command Deck is shown to clients from a public link. Every one of its views draws its stage with three.js, and three r169 creates only WebGL 2 contexts. Corporate laptops, remote desktop sessions and hardened browsers often offer no WebGL at all. On such a machine `WebGLRenderer` throws from the canvas's layout effect, nothing in the deck caught it, and Next.js replaced the whole page, header and panel included, with its unbranded "Application error" screen. The same happened for any runtime error inside a scene, because react-three-fiber rethrows every scene error into the React tree. A client who opened the link on a locked-down laptop saw a dead page.

The deck also failed the room it is presented in. Its quietest grey read at about 4:1 and much of its text was set at 9 to 11 px, which a projector blurs away; the header ran off a laptop screen; severity was a colour only; the findings table and the record listed rows only a mouse could open. Every presenting sequence started from a key, so a presenter on a tablet or at a lectern could not start or steer one. The cameras were framed for a 1600×900 stage and cut the graph, the pipeline and the city on a square laptop stage or an upright phone, where the orbit controls also captured every swipe, so the page could not be scrolled past the stage. Labels over the scenes fell on each other and on the view's title. Headings printed a run's directory name, such as `2026-09-19-nodegoat-2`; the event feed listed hundreds of tool calls one per row and printed a certificate as raw JSON; two divisions of the published roster had no palette colour and drew in the same grey; and the published fixtures carried absolute paths of the machine that recorded them.

## Decision

**Every stage mounts behind one gate.** `components/three/WebGLGate.tsx` exports `WebGLGate`, which each view wraps around its dynamically imported stage. On the first client render the gate asks a scratch canvas for a `webgl2` context, releases it, and remembers the answer for the page load. Without a context the scene, and the three.js chunk it would load, never mount: the stage shows the view's still from `public/posters/<view>.jpg`, resolved under `NEXT_PUBLIC_BASE_PATH`, under a note that the panel has the full record. The panel, the header and every tab keep working, because nothing outside the stage depends on the canvas.

**The gate is also the stage's error boundary.** `SceneBoundary`, a class component, holds any error a stage throws after mounting to the stage: the view shows the same still with the error's message and a button that mounts the scene again. `Stage` raises a lost WebGL context as such an error, since a context the browser takes back leaves a black canvas that three.js does not restore by itself; the listener ignores the loss react-three-fiber forces half a second after an ordinary unmount.

**Errors outside a stage keep the shell.** `app/error.tsx` renders the deck's own error screen (`components/shell/DeckError.tsx`) in place of a view that throws, inside the root layout, so the header, navigation and footer stay. `app/global-error.tsx` renders the same screen under a header of its own, with plain links to every view, when the shell itself throws.

**The posters are stills of the real scenes.** Each is the stage alone, captured from the static export at 1600×900 over the committed fixtures with the overlay copy hidden, so the view's own title does not appear twice. They are JPEG files of under 100 KB each, because the scenes' film grain and bloom make a PNG of the same frame many times larger.

**One mechanism for every view.** The [Operations view](2026-09-28-operations-center.md) shipped its own probe, boundary and context watch around a floor drawn flat as SVG; they are folded into the gate, which takes either a still (`poster`) or a drawing the view makes from its own data (`flat`), and `/ops` passes its flat floor. `?flat` on the address, which the Operations view introduced, now asks every stage for its stand-in, so a presenter can rehearse the fallback on a machine that has WebGL.

**Presenting needs no keyboard.** The header's Present menu (`components/shell/PresentMenu.tsx`) starts the cold open, the guided tour, focus and the findings tour, and `?present=open|tour|focus` starts one from a link once the roster has been read. While a tour runs, `components/shell/TourControls.tsx` shows where it is with Previous, Next and End; the findings tour's position lives in the deck store beside the view tour's, so the bar, the arrow keys and the view step the same tour. A touch never ends a tour, and a click on the presenter controls does not either.

**The deck reads from the back of the room.** Text is set at 12 px or more, uppercase labels at 11 px, and `--ink-3` is `#8494b8`, 6.3:1 against the panel. Below 1100 px the header wraps. Each severity is printed as a word beside its colour, and every clickable row takes focus and opens on Enter or Space (`components/shell/activate.ts`), with a `:focus-visible` ring.

**A stage leaves the page scrollable on touch.** On a coarse pointer each stage's orbit controls are off and the stage's wrapper takes `touch-action: pan-y`, so a swipe scrolls the page and a tap still selects; the stage's **Explore 3D** button (`components/three/explore.ts`) hands the gestures to the controls until the viewer asks for the page back or leaves the view.

**Cameras frame for the stage's aspect.** `components/three/framing.ts` computes how far a camera must stand to hold a subject at a given aspect, and every rig multiplies its designed distances by the ratio of that reach to the reach at `DESIGN_ASPECT`, the 1600×900 stage the shots were composed on. A wider stage keeps the designed shot; a narrower one stands back.

**Labels keep out of each other's way.** `components/enterprise/labels.ts` gives each stage a `LabelField`: once a frame it clears the rectangles labels have taken, and every 500 ms it measures the stage copy the view names (its title, hint and cards). Each label takes, of a few nearby spots, the first that is clear, or else the one that overlaps least, and keeps its spot until another is clearly better, so labels do not flicker. The phone hides the city's district names, which do not fit beside each other at that width.

**Runs are named for people.** `deck/display-name.ts` turns a run's directory name and times into `OWASP NodeGoat · security review · 19 Sep 2026 · 20 min`, from a table of known review subjects and the run's kind; headings, the title card and the run pickers use it, and the id stays in the footer. The event feed folds each run of consecutive tool calls and steps into one row naming its most frequent calls, with **Show every step** to list them; the feed composes a certificate's row as `certificate · 3 of 3 checks pass` (`certificateLine` in `scripts/harness-feed.ts`) and the deck puts the record behind a disclosure.

**Division colours follow the published roster.** `DIVISION_COLOR` in `deck/palette.ts` keys exactly the roster's divisions; `tests/palette.spec.ts` fails when a division has no colour, when two share one, or when the palette keys a division the roster no longer defines.

**No host path is published.** `deck/host-paths.ts` rewrites absolute paths of the recording machine to placeholders (`<repo>`, `<targets>`, `<scratchpad>`, `<tmp>`, `<home>`). The feed's fold applies it to every tool result, directive and certificate it relays; `scripts/snapshot-fixtures.ts` applies it to every payload it writes; the operations collector applies it to its snapshot; and the deck applies it to any snapshot it reads. `tests/fixtures.spec.ts` fails on a host path in a published fixture.

## Alternatives considered

**A 2D rendering of each scene.** A canvas-2D or SVG version of the graph, the pipeline, the city and the workflow would keep the views interactive without WebGL, at the cost of a second renderer per view that has to stay in step with the first. The panel already holds every fact the scenes show, so a still plus the panel meets the need at a fraction of the cost.

**Let `app/error.tsx` catch scene failures.** Without the gate's boundary a scene that throws reaches the route's error boundary, which replaces the whole view and takes the panel with it. Holding the failure to the stage keeps the record readable, and `app/error.tsx` remains the backstop for failures outside a stage.

**Probe for WebGL on the server, or render the poster before the probe answers.** The server cannot know the viewer's browser, and drawing the poster first would flash it under every scene that then mounts. The gate draws nothing for the one frame the probe takes.

**PNG posters.** The scenes carry film grain and bloom, which PNG compresses poorly; four PNG stills at the stage's size cost several megabytes on exactly the constrained machines that need them.

**A layout solver for labels.** A force-directed or global placement would pack labels more tightly, at a cost every frame and with labels that move whenever any one moves. A few fixed spots per label with a preference for the one it holds keeps labels still, which matters more on a projected screen.

**Rename runs in their records, or scrub the fixtures by hand.** The records and fixtures are written by machines and rewritten by every snapshot; a name or a scrub applied to the files would be lost on the next one. The name is a presentation of the record and lives in the deck; the scrub lives where the text is first read, so every later snapshot is clean.

## Consequences

The public link opens on a working deck in any browser: without WebGL each view is a still of its scene beside a fully working panel, and a scene failure costs the scene only. The stills show the committed fixtures at rest, not the run being followed, and answer no click; the note on the stage says the panel is the record. The posters must be re-captured when a scene's look changes, or they will show an older deck than the live one.

A presenter can run the deck from a tablet or a lectern, and a client can follow it on a phone. A newly reviewed target reads by its directory name, capitalised, until `deck/display-name.ts` learns its subject. A division added to the roster fails `tests/palette.spec.ts` until it has a colour, and a new kind of host path reaches the fixtures only if `deck/host-paths.ts` does not know its root, which `tests/fixtures.spec.ts` then reports.
