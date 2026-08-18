// =====================================================================
// Damn Beavers — SuperCollider voice for the generative score (§26)
// ---------------------------------------------------------------------
// 1. Start the bridge:   node tools/audio/osc-bridge.mjs
// 2. Boot this server and run the whole file (Cmd+Return on the block).
// 3. In the game: Sound → enable → check "OSC bridge".
// The game composes; these SynthDefs perform. Tune freely — the score
// stream (notes, sfx, layers, transport) stays the same.
// =====================================================================

(
s.waitForBoot({

// ---------- wooden pluck: Karplus-Strong with a body ----------
SynthDef(\beaversPluck, { |out=0, freq=220, amp=0.2, dur=1, pan=0|
    var burst = WhiteNoise.ar(amp) * EnvGen.kr(Env.perc(0.001, 0.012));
    var sig = Pluck.ar(burst, 1, 0.03, freq.reciprocal, dur * 1.6, coef: 0.32);
    sig = sig + (BPF.ar(burst, freq * 2, 1.2) * 0.5);
    sig = sig * amp;
    DetectSilence.ar(sig, doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- water droplet: rising sine ----------
SynthDef(\beaversDroplet, { |out=0, freq=880, amp=0.15, pan=0|
    var sig = SinOsc.ar(EnvGen.kr(Env([freq*0.55, freq*1.04], 0.055, \exp))) * amp;
    sig = sig * EnvGen.kr(Env.perc(0.008, 0.16), doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- soft bell ----------
SynthDef(\beaversBell, { |out=0, freq=660, amp=0.2, dur=1.2, pan=0|
    var sig = Mix.ar([
        SinOsc.ar(freq, 0, 0.6),
        SinOsc.ar(freq * 2.01, 0, 0.2),
        SinOsc.ar(freq * 2.74, 0, 0.08)
    ]) * amp;
    sig = sig * EnvGen.kr(Env.perc(0.006, dur * 1.4), doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- bird ----------
SynthDef(\beaversBird, { |out=0, freq=2400, amp=0.1, dur=0.1, pan=0|
    var fenv = EnvGen.kr(Env([freq*0.82, freq*1.16, freq*0.94], [dur*0.4, dur*0.6], \exp));
    var sig = SinOsc.ar(fenv) * amp * EnvGen.kr(Env.perc(0.012, dur), doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- cricket ----------
SynthDef(\beaversCricket, { |out=0, freq=4200, amp=0.06, dur=0.05, pan=0|
    var sig = LFTri.ar(freq) * LFPulse.ar(42, 0.5) * amp;
    sig = sig * EnvGen.kr(Env.perc(0.005, dur), doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- civilizational bass ----------
SynthDef(\beaversBass, { |out=0, freq=110, amp=0.3, dur=2, pan=0|
    var sig = SinOsc.ar(freq) + (LFTri.ar(freq * 2) * 0.18);
    sig = sig * amp * EnvGen.kr(Env.linen(0.09, dur * 0.6, 0.5), doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- lament reed ----------
SynthDef(\beaversLament, { |out=0, freq=330, amp=0.2, dur=1.5, pan=0|
    var vib = SinOsc.kr(4.6, 0, 5);
    var sig = Mix.ar([LFTri.ar(freq + vib - 6), LFTri.ar(freq + vib + 5)]) * 0.5;
    sig = BPF.ar(sig, 760, 0.8) * amp;
    sig = sig * EnvGen.kr(Env.linen(0.16, dur * 0.6, 0.4), doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- one noise-work synth covers every sfx name ----------
SynthDef(\beaversSfx, { |out=0, amp=0.2, pan=0, filtFreq=800, filtQ=1, atk=0.01, rel=0.2, pitch=100, pitchEnd=50, toneMix=0.5, dur=0.3|
    var noise = BPF.ar(WhiteNoise.ar, filtFreq, filtQ) * (1 - toneMix);
    var tone = SinOsc.ar(EnvGen.kr(Env([pitch, pitchEnd], [rel], \exp))) * toneMix;
    var sig = (noise + tone) * amp * EnvGen.kr(Env.perc(atk, rel + dur), doneAction: 2);
    Out.ar(out, Pan2.ar(sig, pan));
}).add;

// ---------- beds: water, wind, rain, pad ----------
~water = { |gain=0, cutoff=760|
    var src = BPF.ar(BrownNoise.ar, LFNoise1.kr(0.17).range(cutoff-210, cutoff+210), 0.55);
    Out.ar(0, Pan2.ar(src * gain * 0.16, 0));
}.play;
~water.addSpec(\gain, [0, 1]); ~water.addSpec(\cutoff, [200, 2000]);

~wind = { |gain=0, cutoff=420|
    var src = LPF.ar(PinkNoise.ar, cutoff) * (1 + (LFNoise1.kr(0.09) * 0.4));
    Out.ar(0, Pan2.ar(src * gain * 0.14, 0));
}.play;

~rain = { |gain=0| Out.ar(0, Pan2.ar(HPF.ar(Crackle.ar(1.95) + PinkNoise.ar, 1500) * gain * 0.10, 0)) }.play;

~fire = { |gain=0| Out.ar(0, Pan2.ar(BPF.ar(WhiteNoise.ar * LFNoise0.kr(9).range(0.3, 1), 1500, 0.9) * gain * 0.2, 0)) }.play;

~padVoices = List[];
~padGain = 0.12; ~padBright = 900;
~setChord = { |midis|
    ~padVoices.do { |syn| syn.set(\gate, 0) };
    ~padVoices = midis.collect { |midi|
        Synth(\beaversPad, [\freq, midi.midicps, \amp, ~padGain / midis.size.max(1), \cutoff, ~padBright]);
    };
};
SynthDef(\beaversPad, { |out=0, freq=110, amp=0.05, cutoff=900, gate=1|
    var sig = Mix.ar([Saw.ar(freq, 0.5), Saw.ar(freq * 1.004, 0.5)]);
    sig = LPF.ar(sig, cutoff) * amp;
    sig = sig * EnvGen.kr(Env.asr(2.1, 1, 2.4), gate, doneAction: 2);
    Out.ar(out, Pan2.ar(sig, LFNoise1.kr(0.05).range(-0.3, 0.3)));
}).add;

// ---------- OSC routing ----------
~midi = { |m| m.midicps };

OSCdef(\note, { |msg|
    var voice = msg[1].asSymbol, midi = msg[2], vel = msg[3], durBeats = msg[4], pan = msg[5], gain = msg[6];
    var synth = (\pluck: \beaversPluck, \droplet: \beaversDroplet, \bell: \beaversBell, \bird: \beaversBird,
        \cricket: \beaversCricket, \bass: \beaversBass, \lament: \beaversLament).at(voice) ? \beaversPluck;
    Synth(synth, [\freq, midi.midicps, \amp, vel * gain, \dur, durBeats.max(0.1), \pan, pan.clip(-1, 1)]);
}, "/beavers/note");

// sfx name -> filter/tone recipe (kept in one Event for easy tweaking)
~sfxRecipes = (
    \woodCrack: (freq: 1000, q: 1.4, atk: 0.004, rel: 0.14, pitch: 120, pitchEnd: 48, toneMix: 0.25, dur: 0.15),
    \woodTap:   (freq: 1400, q: 2.5, atk: 0.004, rel: 0.05, pitch: 220, pitchEnd: 110, toneMix: 0.5, dur: 0.05),
    \gnaw:      (freq: 1400, q: 3,   atk: 0.012, rel: 0.09, pitch: 300, pitchEnd: 240, toneMix: 0.05, dur: 0.05),
    \thump:     (freq: 300,  q: 0.8, atk: 0.006, rel: 0.2,  pitch: 150, pitchEnd: 55,  toneMix: 0.75, dur: 0.1),
    \subDrop:   (freq: 130,  q: 0.5, atk: 0.02,  rel: 0.5,  pitch: 96,  pitchEnd: 36,  toneMix: 0.85, dur: 0.4),
    \splash:    (freq: 1300, q: 0.9, atk: 0.01,  rel: 0.28, pitch: 700, pitchEnd: 500, toneMix: 0.08, dur: 0.1),
    \paddle:    (freq: 520,  q: 0.7, atk: 0.03,  rel: 0.14, pitch: 300, pitchEnd: 220, toneMix: 0.05, dur: 0.05),
    \footstep:  (freq: 210,  q: 0.8, atk: 0.005, rel: 0.06, pitch: 120, pitchEnd: 70,  toneMix: 0.4,  dur: 0.03),
    \scrape:    (freq: 400,  q: 1.1, atk: 0.015, rel: 0.18, pitch: 200, pitchEnd: 120, toneMix: 0.1,  dur: 0.08),
    \munch:     (freq: 520,  q: 2,   atk: 0.01,  rel: 0.1,  pitch: 260, pitchEnd: 190, toneMix: 0.2,  dur: 0.05),
    \breath:    (freq: 320,  q: 0.5, atk: 0.25,  rel: 0.4,  pitch: 120, pitchEnd: 110, toneMix: 0.05, dur: 0.1),
    \creak:     (freq: 560,  q: 4,   atk: 0.09,  rel: 0.5,  pitch: 90,  pitchEnd: 130, toneMix: 0.6,  dur: 0.15),
    \rustle:    (freq: 2600, q: 0.7, atk: 0.02,  rel: 0.26, pitch: 800, pitchEnd: 700, toneMix: 0.02, dur: 0.05),
    \crackle:   (freq: 1900, q: 0.8, atk: 0.004, rel: 0.12, pitch: 900, pitchEnd: 800, toneMix: 0.05, dur: 0.08),
    \whoosh:    (freq: 800,  q: 0.6, atk: 0.3,   rel: 0.8,  pitch: 300, pitchEnd: 200, toneMix: 0.03, dur: 0.2),
    \thunder:   (freq: 120,  q: 0.5, atk: 0.07,  rel: 2.2,  pitch: 46,  pitchEnd: 30,  toneMix: 0.5,  dur: 1.2),
    \gust:      (freq: 500,  q: 0.7, atk: 0.5,   rel: 1.0,  pitch: 240, pitchEnd: 180, toneMix: 0.03, dur: 0.3),
    \cough:     (freq: 330,  q: 1.6, atk: 0.015, rel: 0.16, pitch: 200, pitchEnd: 140, toneMix: 0.35, dur: 0.06),
    \chatter:   (freq: 900,  q: 2,   atk: 0.012, rel: 0.16, pitch: 660, pitchEnd: 700, toneMix: 0.6,  dur: 0.06),
    \scuffle:   (freq: 760,  q: 1,   atk: 0.01,  rel: 0.2,  pitch: 130, pitchEnd: 60,  toneMix: 0.4,  dur: 0.12)
);
~camel = { |name| name.asString.split($-).collect(_.capitalize).join.asSymbol }; // "wood-crack" -> \woodCrack

OSCdef(\sfx, { |msg|
    var recipe = ~sfxRecipes[~camel.(msg[1])];
    if (recipe.notNil) {
        var intensity = msg[2], size = msg[3], pan = msg[4], gain = msg[5];
        Synth(\beaversSfx, [
            \amp, intensity * gain,
            \pan, pan.clip(-1, 1),
            \filtFreq, recipe[\freq] * (0.7 + (size * 0.6)),
            \filtQ, recipe[\filtQ],
            \atk, recipe[\atk], \rel, recipe[\rel],
            \pitch, recipe[\pitch] * (0.6 + (size * 0.8)),
            \pitchEnd, recipe[\pitchEnd],
            \toneMix, recipe[\toneMix], \dur, recipe[\dur]
        ]);
    };
}, "/beavers/sfx");

OSCdef(\layer, { |msg|
    var param = msg[1].asSymbol, value = msg[2];
    switch(param,
        \waterGain, { ~water.set(\gain, value) },
        \waterCutoff, { ~water.set(\cutoff, 380 + (value * 900)) },
        \windGain, { ~wind.set(\gain, value) },
        \windCutoff, { ~wind.set(\cutoff, 240 + (value * 700)) },
        \rainGain, { ~rain.set(\gain, value) },
        \fireGain, { ~fire.set(\gain, value) },
        \padGain, { ~padGain = value * 0.16; ~padVoices.do { |v| v.set(\amp, ~padGain / 5) } },
        \padBrightness, { ~padBright = 320 + (value * 1600); ~padVoices.do { |v| v.set(\cutoff, ~padBright) } }
    );
}, "/beavers/layer");

OSCdef(\chord, { |msg| ~setChord.(msg[1..]) }, "/beavers/chord");
OSCdef(\transport, { |msg| "transport: % bpm, beat %".format(msg[1], msg[2]).postln }, "/beavers/transport");

"Damn Beavers SC voice ready — %".format(NetAddr.localAddr).postln;
});
