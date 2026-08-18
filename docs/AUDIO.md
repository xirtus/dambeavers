# AUDIO.md — the generative score (Architecture Contract §26)

Damn Beavers has no soundtrack files and no sound-effect samples. The game
**composes a control stream** — notes, material hits, continuous beds,
transport — from observed simulation state, and instruments perform it:

| instrument | where | setup |
|---|---|---|
| Built-in WebAudio synth | `src/audio/webaudio-synth.ts` | none — click 🔊 Sound |
| OSC (SuperCollider / Max / Pd / TouchDesigner) | `tools/audio/osc-bridge.mjs` | `node tools/audio/osc-bridge.mjs`, then enable "OSC bridge" |
| Web MIDI (DAW / hardware) | `src/audio/midi-out.ts` | enable "MIDI out", pick a destination |

The same stream drives all three simultaneously. The stream is the
product; the instruments are interchangeable.

## Laws (contract §26)

1. **The score observes; it never conducts the world.** Every note derives
   from render frames (projected authoritative state), real bridge queries
   (`inspectCell` water probes), or genuine UI gestures. Nothing writes to
   the sim; nothing in the sim knows sound exists.
2. **Everything that happens sounds.** Every EventLog type the colony loop
   records projects to a render event (verbatim `sourceType`), and every
   render event kind has a composed recipe (`gesture-map.ts`). Unmapped
   future history falls back to a quiet, consistently-pitched bell —
   audible, never random, never silent.
3. **The world plays in time.** Events quantize to the transport grid
   (heavy happenings on beats, small ones on eighths); work loops lock to
   it, so simultaneous labor becomes polyrhythm, not noise.
4. **Determinism where practical.** All generative chance draws from
   `slotRandom(worldHash, slot, salt)` — a pure function of world seed and
   beat index. The same world, watched the same way, plays the same piece.
   The conductor core is pure, headless-tested TypeScript
   (`src/presentation/audio/`); browser APIs live only in `src/audio/`.
5. **Autoplay honesty.** Sound starts only from a player's real click
   (or `?audio=1` for captures/kiosks). Deterministic captures stay silent.

## The score model

- **World identity** (`music-theory.ts`): the world seed chooses a root
  (low, earthy), a mode family (`grove` = major-pentatonic day /
  hirajoshi night, `river` = lydian day / minor-pentatonic night,
  `lodge` = yo day / insen night; storms take a tense flattened-second
  color in every family), a walking-andante tempo (58–71 bpm), a
  four-chord pastoral cycle (one chord per two bars), and a five-step
  colony motif. Two worlds genuinely sound different; one world always
  sounds like itself.
- **Transport**: beats advance only while the sim runs, at
  `bpm/60 × speed^0.35` — 8× game speed is brisk (≈2×), never frantic.
  Pause holds the chord (the pad sustains, hushed).
- **Beds**: water babble (gain/cutoff from real probed depths around the
  camera + observed flow churn), wind (zoom height + weather), rain hiss,
  fire glow, and the chord pad (brightness follows the real sun).
- **Generators**: rain is a pentatonic music-box (each droplet a scale
  tone — rain literally plays the mode); birds sing seeded phrases by
  day; crickets hold a per-night ostinato; the colony work-song gives
  each nearby beaver a wooden pluck voice walking the world motif over
  the current chord; drinkers plink; sleepers breathe.
- **Events** (`gesture-map.ts`): tree-fells crack and land on the
  downbeat with a warm fifth; dam segments drop a civilizational sub-bass
  root; constructions finish with a two-knock cadence; births rise
  through the motif as bells; deaths sink into a three-note reed lament
  (drowning splashes, starvation hollows, trauma strikes); gates creak
  open *up* and close *down*; fights scuffle; fire crackles; social
  moments chirp softly. Even spoilage has a small dull thud.
- **The ear is the camera**: gain follows real distance, pan follows the
  camera's right vector, and if the camera dips below the real water
  surface the whole world muffles low-pass (all backends honor `muffle`).

## OSC address scheme (UDP, default 127.0.0.1:57120)

```
/beavers/note  voice:s midi:i velocity:f durBeats:f pan:f gain:f whenSec:f
/beavers/sfx   name:s intensity:f size:f pan:f gain:f whenSec:f
/beavers/layer param:s value:f        (waterGain, waterCutoff, waterTrickle,
                                       windGain, windCutoff, rainGain, fireGain,
                                       padGain, padBrightness, birdDensity,
                                       cricketDensity, muffle)
/beavers/chord midi:i midi:i ...      (pad harmony changed)
/beavers/transport bpm:f beat:f beatsPerSecond:f running:i
```

`whenSec` is seconds-from-now (schedule into your synth's future).
Voices: `pluck droplet bell bird cricket bass lament`.
Sfx names: `wood-crack wood-tap gnaw thump sub-drop splash paddle
footstep scrape munch breath creak rustle crackle whoosh thunder gust
cough chatter scuffle ui-confirm ui-tool ui-error ui-save ui-toast`.

### Run it

```sh
node tools/audio/osc-bridge.mjs            # ws://localhost:8787 -> udp 127.0.0.1:57120
node tools/audio/osc-bridge.mjs --osc-port 57121 --osc-host 192.168.1.20 -v
```

SuperCollider: boot the server, run `tools/audio/dambeavers.scd`, then in
the game: 🔊 Sound → ✓ OSC bridge. The patch voices every address above
with a pastoral wood-and-water palette and is meant to be hacked on — the
score stream stays stable.

## MIDI map (Web MIDI)

| ch | part | GM program |
|---|---|---|
| 1 | pad (held chord tones) | String Ensemble 1 |
| 2 | pluck / colony motif / event plucks | Marimba |
| 3 | droplets (rain music-box, trickle) | Vibraphone |
| 4 | bells, birds, crickets | Tubular Bells |
| 5 | bass (dam stone, lament floor) | Acoustic Bass |
| 6 | lament reed | English Horn |
| 10 | every work/weather/UI sfx | GM percussion map (see `SFX_DRUM`) |

CC 74 on melodic channels broadcasts the underwater muffle.

## URL parameters

- `?audio=1` — start the score without a click (captures, kiosks).
- `?osc=ws://host:port` — override the bridge address.

## Verifying

- `npm test` — conductor determinism/coverage/grid/spatial tests, music
  theory invariants, OSC byte vectors, projection coverage
  (`tests/unit/audioConductor.test.ts`, `musicTheory.test.ts`,
  `oscEncode.test.ts`, `tests/presentation/renderEventsAudio.test.ts`).
- `npm run check:audio` — live smoke test: real game in headless Chrome
  drives real commands; asserts gestures are emitted and the OSC bridge
  forwards real packets (`tools/audio/smoke-test.mjs`).
