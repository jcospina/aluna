# The spark — visual and technical references

Research for Aluna's companion: the bright, moving, magical thing that narrates, crosses
the desk, and turns a prompt into a capability. Gathered 2026-08-10.

**This file is transient.** A gathering step, not a contract. When the spark is settled
it goes into a page and this folder gets deleted, the same way `design/research/` was
folded into `logo.html` and removed. Nothing here is a decision.

---

## 0. The frame

**The spark is a light. It is not a surface.** That distinction decides everything
downstream, and the design system already contains the precedent: the logo tile is
exempt from D11 because *it is a picture rather than a boundary*. The spark is the
second exemption, on the same logic — it is emission rather than a boundary.

So:

- **It is not drawn with the hand.** No deviation, no double inking, no mitred corners.
  Those belong to chrome — windows, buttons, cards, the things you press. A hand-drawn
  spark would be furniture pretending to be alive.
- **Glow, bloom, blur, gradients and additive blending are all available to it.** The
  no-gradient, no-blur, one-ink rules describe how *surfaces* are painted. Light is not
  a surface. A bright object on this desk does not conflict with a flat UI any more than
  sunlight conflicts with a flat wall.
- **It renders in its own layer**, above everything, with its own techniques and its own
  performance budget.

What the spark *does* share with the rest of the system: the palette's hues (it can be
sun, clay, teal, leaf at full strength — the small-area rule already permits maximum
chroma on small objects), and the discipline of the surface it floats over.

The one thing to write down explicitly when this is settled: **an exemption stated is an
exemption defended.** L4 exists so nobody "fixes" the logo tile to match the line. The
spark needs the same sentence or someone will flatten it in six months.

---

## 1. Shape: why not round

Siri is round, and round is the wrong read. Shape language is unusually well-codified
here and the mapping is direct: circles read as *soft, unity, harmony, innocence,
containment*; triangles and sharp angles read as *energy, speed, tension,
unpredictability*. A sphere is a contained volume — it is the shape of a thing that
holds still.
[Shape language in character design](https://pixune.com/blog/shape-language-technique/) ·
[Shape language and readability (80 Level)](https://medium.com/@EightyLevel/character-design-shape-language-and-readability-6ee4bb6f98a6) ·
[Shape language & silhouette](https://www.conceptstart.net/art-tutorial/improve-shape-language-silhouette-in-concept-art-design-illustration)

Siri's roundness is also structural, not stylistic: the current implementations are a
*sphere* — a fragment-shader ball with simplex-noise displacement and a Fresnel rim that
brightens the edges. Fresnel is what makes it glow at the silhouette, and Fresnel is a
property of a curved surface. You cannot un-round it without abandoning the technique.
[Building a voice-reactive orb](https://medium.com/@therealmilesjackson/building-a-voice-reactive-orb-in-react-audio-visualization-for-voice-assistants-2bee12797b93) ·
[SmoothUI Siri Orb](https://smoothui.dev/docs/components/siri-orb) ·
[Siri-style GLSL shaders](https://aaaa-zhen.github.io/siri-glsl/siri-wave.html) ·
[Audio-reactive liquid blobs (Shadertoy)](https://www.shadertoy.com/view/3c3fDr)

### The anatomy that isn't round

A spark is not one shape, it is **four components at different scales**, and that is
where the life is:

| Component | What it does | Reference |
|---|---|---|
| **Core** | The point of emission. Small, hottest, most saturated. Reads as *where the thing is* | — |
| **Rays** | Anisotropic streaks radiating from the core. What makes it a *spark* and not a *ball* | Diffraction spikes |
| **Corona / halo** | The soft bloom around the core. Reads as *brightness* | Bloom post-processing |
| **Particles** | Emitted embers, drifting and dying. Reads as *aliveness* and *effort* | Particle systems |
| **Trail** | What it leaves behind when it moves. Reads as *speed* and *intent* | — |

None of these is a circle. The silhouette is a starburst with a fuzzy edge and a debris
field, which is exactly what "spark" means and exactly what an orb is not.

### Rays have a physics, and the physics is designable

This is the most useful single finding in this pass. Bright points get rays for a real
optical reason: **diffraction spikes**. Light diffracts as it passes the straight edges
of an aperture or its obstructions. In a Newtonian telescope the four vanes holding the
secondary mirror produce the four-pointed star — *each vane produces two spikes, and the
opposing pairs coincide, so four vanes give four visible spikes.* The same effect happens
in camera apertures (blade count decides the ray count) and in the naked eye at night
(eyelashes). Higher-intensity sources yield more prominent spikes.
[Diffraction spike](https://en.wikipedia.org/wiki/Diffraction_spike) ·
[BBC Sky at Night: diffraction spikes explained](https://www.skyatnightmagazine.com/advice/what-are-diffraction-spikes) ·
[Computational imaging of starburst diffraction spikes (Nature Sci. Rep.)](https://www.nature.com/articles/s41598-018-34400-z)

Why this matters for Aluna: **ray count and ray angle stop being arbitrary.** Give the
spark a notional aperture and its rays follow from it. Four rays is the telescope and the
camera; six is a hexagonal aperture; two is anamorphic. And *spike prominence scales with
intensity*, which hands you a free state channel — the spark's rays lengthen as it works
harder, for a reason, rather than because an animator decided so.

It also gives a way to be distinctive: the standard AI sparkle is a four-point star with
concave sides. An odd count, an asymmetric set, or rays of unequal length reads as *a
real light* rather than *the icon*.

### The sparkle-icon problem, which is serious

Google's own UX research: three studies, 2,000 participants, eight countries. Users do
recognise the sparkle as meaning AI and respond positively — but by 2024 there were
**nearly 100 different sparkle icons across Google products alone, with usage growing up
to 37% quarterly**, and users cannot distinguish what kind of AI any of them means.
NN/G's version of the finding is blunter: as of late 2024, **17% of people read a sparkle
as favourite/save**, because a sparkle looks like a star and 73% associate stars with
saving.
[Google Design: rise of the AI sparkle icon](https://design.google/library/ai-sparkle-icon-research-pozos-schmidt) ·
[NN/G: the proliferation and problem of the ✨ icon](https://www.nngroup.com/articles/ai-sparkles-icon-problem/) ·
[Slate: AI tools all use the same sparkly icon](https://slate.com/technology/2025/12/artificial-intelligence-tools-icon-google-gemini-chatgpt-design.html) ·
[Fast Company: how the sparkles emoji took over AI](https://www.fastcompany.com/91030156/how-the-sparkle-emoji-took-over-ai)

**The constraint this puts on the design:** a static four-point star at rest is now
generic to the point of being unreadable as *anything specific*. Aluna's spark escapes
this in one specific way — it is **never static**. It is a moving, emitting, trailing
thing that exists for the duration of a task, not a glyph on a button. That is a real
differentiator, but it means the spark should probably never be reduced to a still
four-point mark (in the favicon, in marketing, in an empty state) without knowing it is
walking straight into the cliché.

### Shape over time: the fire lesson

Fire is the best-studied "how do I make a formless bright thing feel alive" problem, and
the VFX principles are consistent:

- **Silhouette is S-curves morphing into C-curves and back.** Not blobs, not circles —
  curves with direction.
- **Asymmetry and constant variation are the whole trick.** Uniform clumps kill it.
  Stylized fire uses sharp *hook* accents against hollow *C-shapes* for overlapping depth.
- **Redrawing a wild shape repeatedly, changed slightly each frame, is what flickers.**
- An **S-swoop anchor line** traces the ambient wind and erratic gusts, so the whole
  effect has a direction it is being pushed in.
- **Two independent flicker passes** on opacity, at different timings, so the light never
  reads as a single loop.

[VFX Apprentice: how to draw stylized fire and flames](https://www.vfxapprentice.com/blog/how-to-draw-stylized-fire-flames) ·
[VFX Apprentice: everything to know about fire FX](https://www.vfxapprentice.com/blog/everything-know-about-fire-fx) ·
[Creating fire effects: principles, not a tutorial](https://medium.com/@myas.drmax/creating-fire-effects-principles-not-a-tutorial-a11f983ba7ec) ·
[Designing elemental character FX](https://www.vfxapprentice.com/blog/design-elemental-character-fx)

The last of those is directly on-brief — "elemental character FX" is the discipline of
making an effect that is *also a character*, which is exactly what the spark is.

---

## 2. The choreography, beat by beat

### Beat 1 — the prompt bar becomes the spark

**Do it as a disintegration, not a morph.** The magical read is that the bar comes apart
into particles which then *converge* into the spark — matter becoming energy. A path morph
is a UI transition; a dissolve-and-gather is a transformation.

The technique is well-trodden. Rasterise the DOM element (html2canvas or the newer
HTML-in-canvas path), sample it with `getImageData`, spawn one particle per sampled pixel
carrying that pixel's colour, then run them under physics. Reversing the same system —
particles converging to a target — is how the effect runs backwards.
[Disintegrate.js](https://github.com/ZachSaucier/Disintegrate) ·
[CSS-Tricks: particle effects on DOM elements with canvas](https://css-tricks.com/adding-particle-effects-to-dom-elements-with-canvas/) ·
[Pixel disintegration demo](https://html-in-canvas.dev/demos/pixel-disintegration/) ·
[Codrops: dissolve effect with shaders and particles in Three.js](https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/) ·
[particle-effect-buttons](https://github.com/afdon/particleeffectsbuttons)

**The timing is a solved problem too.** The traditional 2D magic-sparkle timing is
*gather slow, burst fast*: a long hold, then accelerating exposures — the documented
pattern is 7,2,2,2,2,2,2,1,1,1,1,1,1 frames, with the sparkle concentrating in the middle
before it explodes outward, then settling into a stable loop.
[Clip Studio: the ultimate guide to animating a magic sparkle](https://tips.clip-studio.com/en-us/articles/7666) ·
[Clip Studio: lightning, fire and sparkles](https://tips.clip-studio.com/en-us/articles/7688)

Mapped onto Aluna: the bar holds, hesitates (**anticipation** — the principle that makes
the following action land), then collapses fast, then the spark settles into its idle
loop. Anticipation and arcs are the two of the twelve principles that matter most for a
weightless object; everything moves in arcs, never straight lines.
[The 12 principles in VFX](https://www.mad-vfx.com/blogs/principles-of-animation-in-visual-effects) ·
[Understanding the 12 principles](https://www.pluralsight.com/resources/blog/software-development/understanding-12-principles-animation)

**Constraints this beat creates:**

- The input element dies. Typed-but-unsubmitted text, focus state, and the blank-prompt
  refusal all live on it.
- **The reverse must exist.** If generation fails, particles fly back and reassemble into
  a prompt bar with the user's text intact. Design it as reversible or the failure path
  has nowhere to go. The good news: a converge-from-particles system runs backwards for
  free, which is a strong argument for choosing it over a morph.

### Beat 2 — the spark works, and narrates

**Idle life** comes from layered, unsynchronised noise: low-frequency drift on position,
independent flicker passes on intensity, particle emission that varies in rate. The
governing rule from the fire work applies directly — two independent passes at different
timings so nothing ever reads as one loop.

**State through colour, with a principled split.** The research is clean on this:
*saturation controls arousal intensity* (vivid = stronger physiological response,
regardless of hue) while *temperature shapes the emotional quality* of that arousal, not
its magnitude.
[Colour temperature as emotional regulation](https://kxuu.medium.com/color-temperature-as-emotional-regulation-rather-than-decoration-a13022ad242a) ·
[Colour temperature psychology and behaviour](https://blog.lightbulbs-direct.com/behavioural-impacts-of-colour-temperature-psychology/)

So the spark gets two independent channels, which is more expressive than one:
- **Saturation / intensity** = how hard it is working. Ray length scales with it too, per
  the diffraction physics.
- **Temperature** = what it is doing. Cool while it reads and plans, warming as it builds,
  hottest at the moment of creation.

Navi is the cheap precedent for colour-as-state on an object too small to hold detail —
she began as a targeting marker, and colour-changing-to-signal-threat came out of the form
rather than the other way round.
[Navi (The Legend of Zelda)](https://en.wikipedia.org/wiki/Navi_(The_Legend_of_Zelda))

**Narration: the model is Bastion.** Reactive narration written *short by design
constraint*, commenting on what is happening as it happens, never interrupting the thing
it describes. Supergiant's own account is explicit that lines had to be short to achieve
the moment-to-moment feel, that the narrator says little partly because he *cannot* talk
much during play, and that gameplay is never interrupted for the sake of story.
[Supergiant: in-depth, writing Bastion](https://www.supergiantgames.com/blog/in-depth-writing-bastion/) ·
[Why Bastion's narrator works](https://www.gamesradar.com/bastions-narrator-is-a-silver-tongued-storyteller/) ·
[Dynamic narration can replace cutscenes](https://xblafans.com/bastion-dynamic-narration-can-replace-cutscenes-9336.html)

One short line per **real event** — reading the prompt, choosing the shape, laying out
fields, drawing the logo, setting it down. Not a token stream, not a fake percentage.

Evidence for keeping it light rather than elaborate: the CHI 2025 study on AI image
generation waits found users *accept and even value* the wait, associating longer
generation with better output — and **rarely noticed the generation cues at all**.
[While We Wait… (CHI EA '25)](https://dl.acm.org/doi/10.1145/3706599.3719725) ·
[Telerik: loading UI/UX patterns for AI applications](https://www.telerik.com/blogs/loading-ui-ux-patterns-ai-applications)

If you do stream text, the practical numbers: ~5ms per character (~200 chars/s) reads as
smooth without being slow, and tokens should be batched to one render per animation frame.
[Upstash: smooth text streaming](https://upstash.com/blog/smooth-streaming) ·
[flowtoken](https://github.com/Ephibbs/flowtoken)

**Placement is the unsolved part.** The spark moves; text must be read. Either the text
follows it (hard to read, collides with edges), or it sits where the bar was (stable but
breaks the illusion), or **the spark holds still while it speaks**. The third is the
Bastion answer and also the accessible one.

### Beat 3 — the particle flies to the desk and becomes the logo

**Path:** an arc, not a line. A straight flight reads as a UI transition; a curved one
reads as a thing that was *thrown*. CSS `offset-path` + `offset-distance` handles this,
runs on the compositor thread, has been baseline since 2022, and a trail is several
elements on the same path with staggered `animation-delay`.
[MDN: CSS motion path](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_motion_path) ·
[CSS IRL: fun with CSS motion path](https://css-irl.info/fun-with-css-motion-path/) ·
[offset-path on CSS-Tricks](https://css-tricks.com/almanac/properties/o/offset-path/)

If the spark layer is already canvas or WebGL, the flight should live there too rather
than being the one beat in DOM — but `offset-path` is the fallback that needs no second
system.

**The supply problem.** The logo is one hosted Recraft call made when the capability is
grown, and credits are scarce. The particle cannot land into an image that has not
arrived. Three ways out:

- **Land into the tile, then fill.** The particle becomes the logo *tile* — sky band and
  rounded double band, which the shell owns and can draw instantly — and the 32px subject
  appears inside when the generation returns. The tile is already the shell's job, so
  this is honest rather than a workaround.
- **Gate the flight on the image.** Cleanest visually; makes the final beat's timing
  hostage to a third-party API.
- **Land into a placeholder.** Worst — a fifth visual state that exists for one second.

**This supersedes D6** ("seed-to-logo is the arrival animation"). There is no seed. D6
needs rewriting, not re-illustrating.

---

## 3. Rendering: how to actually make it bright

### Additive blending is the base technique

`ctx.globalCompositeOperation = 'lighter'` gives additive blending on canvas 2D:
overlapping particles brighten rather than occlude. It is the standard move for fire,
sparks and energy, it is effectively free, and it is what makes a cluster of dim particles
read as one hot source.
[MDN: globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation) ·
[Particle systems: creating visual effects with code](https://lumitree.art/blog/particle-system) ·
[Konva blend mode guide](https://konvajs.org/docs/styling/Blend_Mode.html)

### Bloom, if the corona needs to be real

The standard pipeline: threshold the bright pixels above a luminance cutoff, blur them,
composite back over the original. Blur is separable — one horizontal pass, one vertical —
and you downsample the framebuffer before blurring, so a wide soft glow costs far less
than it looks. Three.js ships `UnrealBloomPass`; the modern cheap approach is mip-map
pyramids and Kawase (dual-Kawase) rather than a big Gaussian.
[LearnOpenGL: bloom](https://learnopengl.com/Advanced-Lighting/Bloom) ·
[LearnOpenGL: physically based bloom](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom) ·
[Dual Kawase — video game blurs, and how the best one works](https://blog.frost.kiwi/dual-kawase/) ·
[Bloom effect in nearly-vanilla WebGL](https://github.com/rreusser/bloom-effect-example) ·
[Three.js bloom demo](https://threejsdemos.com/demos/postfx/bloom)

For a single small object, full bloom post-processing is probably overkill — a
pre-rendered radial sprite drawn with `lighter` gets 90% of it. Bloom becomes worth it if
the spark should light *the desk around it*.

### Budgets

| Approach | Ceiling at 60fps | Notes |
|---|---|---|
| Canvas 2D, per-particle `arc()` | Low. 1,000 individual arcs is already slow | Batch: build an `ImageData` buffer and write pixels, or draw one cached sprite |
| CPU particle updates | Chokes around **10k** | Fine — the spark needs hundreds, not thousands |
| GPU / instanced (WebGL) | ~**800k** before dropping below 60fps | `InstancedMesh` vs individual meshes is 15fps vs 60fps at 10k |
| WebGPU compute | **1M+**, up from a ~50k WebGL practical ceiling | Not needed here |
| Draw calls | Under **100** is smooth everywhere; over 500 struggles even on good GPUs | |

[Three.js performance: 60fps patterns](https://www.intelligentgraphicandcode.com/development/threejs-interfaces/performance) ·
[100 Three.js performance tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips) ·
[Building particle systems with Three.js & WebGL shaders](https://www.suboorkhan.com/blogs/particle-systems-threejs-webgl-shaders)

**Read:** canvas 2D with additive blending and batched sprites is almost certainly
enough. A few hundred particles is a *lot* of spark. WebGL buys headroom Aluna does not
need and costs a build step and a dependency on a page that has neither.

### Making it read bright on a bright wallpaper

This is a genuine perceptual problem and it is not a rules problem — High Meadow is a
daylight image and there is no dark theme. A light cannot signal brightness by being
brighter than its background when the background is already bright.

What actually works, from the fire and VFX side: **a bright thing reads against a bright
ground because of its dark and saturated components, not its white core.** Fire against a
pale sky reads because of the dark smoke and the deep saturated orange at its base. So the
spark likely needs a saturated mid-tone body under the hot core, and possibly a subtle
dark component in the corona's outer edge, rather than being a white blob with a glow.

Practical check to run when it exists: the wallpaper has three grounds and the spark
crosses all of them during its flight. Test its legibility over each, exactly as the logo
label was.

---

## 4. Caveats and constraints

### 4.1 Two rendering systems on one desk

The spark layer is canvas (or WebGL) sitting over an SVG/DOM surface. That needs explicit
answers for:

- **`pointer-events`** — almost certainly `none`, except on a deliberate control.
- **z-order** — above everything, or the spark disappears behind a maximised window
  mid-narration.
- **Layer sizing** on resize, scroll, and device-pixel-ratio changes.
- **`ink.js`'s mutation observer** — the spark must be excluded from it, not mounted by it.
- **Teardown** — the canvas should not persist idle after the spark is gone.

### 4.2 Flash safety, which is not best-effort

D8 makes accessibility best-effort. Seizure risk is a different category. The numbers,
from W3C's own text:

- No more than **three general flashes and/or three red flashes in any one second**.
- A general flash is *a pair of opposing changes in relative luminance of 10% or more*,
  where the darker image is below 0.80 relative luminance.
- Red flashes are stricter and separate: saturated red is R/(R+G+B) ≥ 0.8.
- **Exempt** if the flashing area is under 0.006 steradians within any 10° visual field
  (25% of a 10° field).

[Understanding SC 2.3.1](https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-does-not-violate.html) ·
[Understanding SC 2.3.2](https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-three-times.html)

**What this actually constrains.** A small spark is almost certainly inside the small-area
exemption, so a fast-flickering core is very likely fine — which is good, because flicker
is where the life is. What is *not* exempt is any moment the light fills a large area: a
flash at the moment of creation, a burst on completion, the screen brightening. Those are
precisely the beats most likely to be designed in for drama. Keep any full-area effect to
a single non-repeating transition, and never put a saturated-red spark into a repeating
pulse.

`prefers-reduced-motion` is already honoured on this surface and the spark is by far the
largest motion object ever added to it. It needs a real answer rather than a disabled
animation — probably: the spark appears in place, the narration still runs, the logo
appears where it belongs. All the beats, no travel and no flicker.
[MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) ·
[Designing accessible animation](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)

For the narration, `role="status"` (implicitly `aria-live="polite"`) announces without
stealing focus. Polite regions that change every few hundred ms produce a backlog or
dropped messages — another argument for beats over streaming.
[MDN: ARIA status role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role) ·
[MDN: ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)

### 4.3 Collapsing the bar removes the only Aluna-owned control

`prompt-bar.js` says it directly: the rail is *the only thing on screen that belongs to
Aluna rather than to a capability*. During generation there is now no Aluna surface except
the spark.

- **Cancel has no home.** Long-running agent work needs an explicit state machine —
  PENDING → RUNNING → {STOPPED, COMPLETED, FAILED}, terminal states terminal — and a way
  to stop. Clicking a moving, glowing, ~24px target is a poor affordance. Either the spark
  parks somewhere clickable while it works, or the narration line carries the control.
  [Agent UX patterns](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) ·
  [The human override UI agents respect](https://medium.com/@Nexumo_/the-human-override-ui-agents-actually-respect-2a4eeef6e66f) ·
  [AI agent error handling patterns](https://blog.jztan.com/ai-agent-error-handling-patterns/)
- **Failure must un-collapse**, with the text intact.
- **Reload mid-generation.** Layout persists in the layout table; does spark state? If not,
  a user who reloads returns to a desk with a prompt bar and no evidence anything is
  happening.

### 4.4 Two locked decisions break

- **D5** — "prompt bar always visible, floating above the desk." Directly contradicted.
  The gain is real (no bar to type into *is* the concurrency block, visually enforced) but
  D5 is locked and needs rewriting, preserving the "never a full-width bottom bar,
  that would be a taskbar" reasoning.
- **D6** — "seed-to-logo is the arrival animation." Superseded entirely.

Also: the "Where the line lives" table's last ruled row reads *"Circles, meaning the lamps
and the flying seed."* The spark inherits that slot and is neither a circle nor drawn, so
that row needs a decision. And the spark needs its own exemption line alongside L4.

### 4.5 Presence after the task

The brief covers birth. It does not cover what the spark does afterwards — wink out,
return and become the prompt bar again, or persist as an ambient presence. This is exactly
what Clippy got wrong: not that it was a cartoon, but that it *stayed*, uninvited, at
moments of focus. Aluna's spark is summoned, which disposes of most of that literature
before it applies — what survives is the exit.
[The New Stack: humanity vs Clippy](https://thenewstack.io/humanity-vs-clippy-lessons-from-microsofts-failed-virtual-assistant/) ·
[5 lessons from Clippy's failure](https://medium.com/twentybn/5-lessons-from-clippys-failure-efc69297eac1)

Note the answer also decides §4.3: if the spark *is* the transformed prompt bar, it must
come back; if it is a being the bar released, it can stay.

### 4.6 Duration is the missing input

At 4 seconds the spark barely needs an idle state and one narration line is plenty. At 90
it needs an idle vocabulary, a sense of progress that is not a fake percentage, and the
ability to be ignored while it works. **This is the single most important unknown** and it
is a runtime fact, not a design one.

### 4.7 Mobile

The desk becomes a phone home screen with one capability filling the screen. A particle
layer on a phone GPU is a different budget, the flight path across 375px is a different
animation, and a spark sized for a desktop desk is a much larger proportion of a phone.

### 4.8 The name has a warning in it

*Ignis fatuus* is "foolish flame"; German *Irrlicht* is "deceiving light." In folklore a
will-o'-the-wisp **misleads travellers**, sometimes into a bog and sometimes worse. The
tradition splits between benevolent guide and mischievous spirit, but the deceiving
reading is older and more common.
[Will-o'-the-wisp](https://en.wikipedia.org/wiki/Will-o%27-the-wisp) ·
[ignis fatuus](https://en.wiktionary.org/wiki/ignis_fatuus)

For a product asking people to trust the thing that built their database, that is a quiet
liability. Either lean toward *ember / hearth-spark / firefly* in user-facing language, or
keep "wisp" internal. What is not available is using the word publicly without knowing
this.

---

## 5. What to decide next

Dependency-ordered — earlier answers constrain later ones.

1. **Is the spark a transformed prompt bar, or a being the bar releases?** Decides the
   exit, the failure path, and whether D5 is amended or replaced.
2. **How long does a generation take?** Decides the entire narration design.
3. **The anatomy:** ray count and geometry (and therefore the notional aperture), core
   size, corona, particle density, trail length.
4. **Canvas 2D + additive, or WebGL?** Almost certainly the former; worth deciding on
   purpose.
5. **Collapse mechanism:** particle disintegration-and-converge, or something else.
6. **Narration placement**, and therefore whether the spark holds still to speak.
7. **What the particle lands into** while the Recraft logo is still in flight.
8. **Cancel**, when there is no prompt bar.
9. **The exemption sentence** — the D11/L4-style line that stops someone flattening the
   spark later.
10. **Whether "wisp" survives** as user-facing vocabulary.

---

## Sources

**Shape, light and VFX** —
[Diffraction spike](https://en.wikipedia.org/wiki/Diffraction_spike) ·
[BBC Sky at Night: diffraction spikes](https://www.skyatnightmagazine.com/advice/what-are-diffraction-spikes) ·
[Computational imaging of starburst diffraction spikes](https://www.nature.com/articles/s41598-018-34400-z) ·
[Shape language in character design](https://pixune.com/blog/shape-language-technique/) ·
[Shape language and readability](https://medium.com/@EightyLevel/character-design-shape-language-and-readability-6ee4bb6f98a6) ·
[Shape language & silhouette](https://www.conceptstart.net/art-tutorial/improve-shape-language-silhouette-in-concept-art-design-illustration) ·
[Communicating through geometry](https://3dsense.net/blogs/shape-language-in-character-design-communicating-through-geometry) ·
[How to draw stylized fire and flames](https://www.vfxapprentice.com/blog/how-to-draw-stylized-fire-flames) ·
[Everything to know about fire FX](https://www.vfxapprentice.com/blog/everything-know-about-fire-fx) ·
[Designing elemental character FX](https://www.vfxapprentice.com/blog/design-elemental-character-fx) ·
[Creating fire effects: principles](https://medium.com/@myas.drmax/creating-fire-effects-principles-not-a-tutorial-a11f983ba7ec) ·
[Collection of stylized VFX](https://realtimevfx.com/t/collection-of-stylized-vfx/11545) ·
[How UX design can help VFX](https://medium.com/wearemighty/how-ux-design-can-help-with-vfx-a0925f80e0f0)

**Sparkle animation and the 12 principles** —
[Clip Studio: animating a magic sparkle](https://tips.clip-studio.com/en-us/articles/7666) ·
[Clip Studio: lightning, fire and sparkles](https://tips.clip-studio.com/en-us/articles/7688) ·
[The 12 principles in visual effects](https://www.mad-vfx.com/blogs/principles-of-animation-in-visual-effects) ·
[Understanding the 12 principles](https://www.pluralsight.com/resources/blog/software-development/understanding-12-principles-animation)

**Assistant prior art** —
[Building a voice-reactive orb](https://medium.com/@therealmilesjackson/building-a-voice-reactive-orb-in-react-audio-visualization-for-voice-assistants-2bee12797b93) ·
[SmoothUI Siri Orb](https://smoothui.dev/docs/components/siri-orb) ·
[Siri-style GLSL shaders](https://aaaa-zhen.github.io/siri-glsl/siri-wave.html) ·
[Audio-reactive liquid blobs](https://www.shadertoy.com/view/3c3fDr) ·
[Pocket-lint: Siri's glowing border](https://www.pocket-lint.com/how-to-get-new-siri-look-glowing-border/) ·
[Navi (The Legend of Zelda)](https://en.wikipedia.org/wiki/Navi_(The_Legend_of_Zelda))

**The sparkle-icon problem** —
[Google Design: rise of the AI sparkle icon](https://design.google/library/ai-sparkle-icon-research-pozos-schmidt) ·
[NN/G: the problem of the ✨ icon](https://www.nngroup.com/articles/ai-sparkles-icon-problem/) ·
[Slate: AI tools all use the same icon](https://slate.com/technology/2025/12/artificial-intelligence-tools-icon-google-gemini-chatgpt-design.html) ·
[Fast Company: how the sparkles emoji took over AI](https://www.fastcompany.com/91030156/how-the-sparkle-emoji-took-over-ai) ·
[Struggling with AI iconography](https://geoffgraham.me/struggling-with-ai-iconography-for-ui-design/)

**Rendering technique** —
[MDN: globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation) ·
[Particle systems with code](https://lumitree.art/blog/particle-system) ·
[Konva blend modes](https://konvajs.org/docs/styling/Blend_Mode.html) ·
[LearnOpenGL: bloom](https://learnopengl.com/Advanced-Lighting/Bloom) ·
[LearnOpenGL: physically based bloom](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom) ·
[Dual Kawase blur](https://blog.frost.kiwi/dual-kawase/) ·
[Bloom in nearly-vanilla WebGL](https://github.com/rreusser/bloom-effect-example) ·
[Three.js bloom demo](https://threejsdemos.com/demos/postfx/bloom) ·
[Three.js 60fps patterns](https://www.intelligentgraphicandcode.com/development/threejs-interfaces/performance) ·
[100 Three.js performance tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips) ·
[Particle systems with Three.js & WebGL shaders](https://www.suboorkhan.com/blogs/particle-systems-threejs-webgl-shaders)

**Disintegration and morph** —
[Disintegrate.js](https://github.com/ZachSaucier/Disintegrate) ·
[CSS-Tricks: particle effects on DOM elements](https://css-tricks.com/adding-particle-effects-to-dom-elements-with-canvas/) ·
[Pixel disintegration](https://html-in-canvas.dev/demos/pixel-disintegration/) ·
[Codrops: dissolve with shaders and particles](https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/) ·
[particle-effect-buttons](https://github.com/afdon/particleeffectsbuttons) ·
[MDN: CSS motion path](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_motion_path) ·
[CSS IRL: fun with CSS motion path](https://css-irl.info/fun-with-css-motion-path/) ·
[CSS-Tricks: offset-path](https://css-tricks.com/almanac/properties/o/offset-path/)

**Narration, waiting and colour** —
[Supergiant: writing Bastion](https://www.supergiantgames.com/blog/in-depth-writing-bastion/) ·
[GamesRadar on Bastion's narrator](https://www.gamesradar.com/bastions-narrator-is-a-silver-tongued-storyteller/) ·
[Dynamic narration can replace cutscenes](https://xblafans.com/bastion-dynamic-narration-can-replace-cutscenes-9336.html) ·
[While We Wait… (CHI EA '25)](https://dl.acm.org/doi/10.1145/3706599.3719725) ·
[Telerik: loading UI/UX patterns for AI](https://www.telerik.com/blogs/loading-ui-ux-patterns-ai-applications) ·
[Upstash: smooth text streaming](https://upstash.com/blog/smooth-streaming) ·
[flowtoken](https://github.com/Ephibbs/flowtoken) ·
[Colour temperature as emotional regulation](https://kxuu.medium.com/color-temperature-as-emotional-regulation-rather-than-decoration-a13022ad242a) ·
[Colour temperature psychology](https://blog.lightbulbs-direct.com/behavioural-impacts-of-colour-temperature-psychology/)

**Agent control and accessibility** —
[Hatchworks: agent UX patterns](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) ·
[The human override UI agents respect](https://medium.com/@Nexumo_/the-human-override-ui-agents-actually-respect-2a4eeef6e66f) ·
[AI agent error handling patterns](https://blog.jztan.com/ai-agent-error-handling-patterns/) ·
[W3C: Understanding SC 2.3.1](https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-does-not-violate.html) ·
[W3C: Understanding SC 2.3.2](https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-three-times.html) ·
[MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) ·
[Pope Tech: accessible animation](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/) ·
[MDN: ARIA status role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role) ·
[MDN: ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)

**Clippy and folklore** —
[The New Stack: humanity vs Clippy](https://thenewstack.io/humanity-vs-clippy-lessons-from-microsofts-failed-virtual-assistant/) ·
[5 lessons from Clippy's failure](https://medium.com/twentybn/5-lessons-from-clippys-failure-efc69297eac1) ·
[Will-o'-the-wisp](https://en.wikipedia.org/wiki/Will-o%27-the-wisp) ·
[ignis fatuus](https://en.wiktionary.org/wiki/ignis_fatuus)
