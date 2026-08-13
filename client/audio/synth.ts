import * as THREE from 'three';
import type { MonsterDef } from '@shared/content/monsters.ts';
import { audio, setPannerPosition } from './engine.ts';

/**
 * Live synthesis.
 *
 * Everything continuous is generated: the hum of a facility that still has
 * power, wind that changes with the weather, and every creature call in the
 * game. A wav loop would give itself away within a minute; a generator will
 * still be producing new noises an hour in, which is exactly how long a bad
 * expedition lasts.
 */

let noiseBuffer: AudioBuffer | null = null;

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    // Slight brown tilt: less fizzy than pure white, sits better under fog.
    last = (last + 0.02 * white) / 1.02;
    data[i] = white * 0.7 + last * 3.2;
  }
  noiseBuffer = buffer;
  return buffer;
}

// ------------------------------------------------------------------ ambience

export type AmbienceKind = 'facility' | 'exterior' | 'ship' | 'depot';

interface Layer {
  nodes: AudioNode[];
  gain: GainNode;
}

export class Ambience {
  private layers = new Map<string, Layer>();
  private kind: AmbienceKind | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private hummGain: GainNode | null = null;
  private scheduled = 0;
  private eventTimer = 0;

  setKind(kind: AmbienceKind, powered: boolean): void {
    const ctx = audio.ctx;
    if (!ctx) return;
    if (this.kind === kind) {
      this.setPowered(powered);
      return;
    }
    this.kind = kind;
    this.stopAll();

    switch (kind) {
      case 'facility':
        this.addRumble(28, 0.055);
        this.addHum(52, 0.03);
        this.addAirflow(0.028, 340);
        break;
      case 'ship':
        this.addRumble(41, 0.035);
        this.addHum(96, 0.022);
        this.addAirflow(0.016, 700);
        break;
      case 'exterior':
        this.addWind();
        break;
      case 'depot':
        this.addHum(60, 0.02);
        this.addAirflow(0.012, 900);
        break;
    }
    this.setPowered(powered);
  }

  setPowered(powered: boolean): void {
    const ctx = audio.ctx;
    if (!ctx || !this.hummGain) return;
    this.hummGain.gain.setTargetAtTime(powered ? 1 : 0.12, ctx.currentTime, 1.6);
  }

  /** 0..1 storm intensity, drives wind volume and rain. */
  setWeather(windAmount: number, rainAmount: number): void {
    const ctx = audio.ctx;
    if (!ctx) return;
    if (this.windGain) this.windGain.gain.setTargetAtTime(windAmount * 0.16, ctx.currentTime, 1.2);
    if (rainAmount > 0 && !this.rainGain) this.addRain();
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(rainAmount * 0.2, ctx.currentTime, 1.4);
  }

  private addLayer(key: string, gain: GainNode, nodes: AudioNode[]): void {
    this.layers.set(key, { gain, nodes });
  }

  /** Deep structural rumble: two detuned oscillators under a heavy low-pass. */
  private addRumble(freq: number, level: number): void {
    const ctx = audio.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    const nodes: AudioNode[] = [];
    for (const detune of [0, 7, -5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start();
      nodes.push(osc);
    }
    filter.connect(gain);
    gain.connect(audio.buses.ambience);
    this.addLayer('rumble', gain, [...nodes, filter]);
  }

  /** Electrical hum with a slow wobble, gated on facility power. */
  private addHum(freq: number, level: number): void {
    const ctx = audio.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq * 2;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const powered = ctx.createGain();
    powered.gain.value = 1;
    this.hummGain = powered;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = level * 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(powered);
    powered.connect(audio.buses.ambience);
    osc.start();
    this.addLayer('hum', gain, [osc, filter, lfo, lfoGain, powered]);
  }

  /** Ventilation: band-passed noise with a wandering centre frequency. */
  private addAirflow(level: number, centre: number): void {
    const ctx = audio.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = getNoise(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = centre;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = level;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = centre * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio.buses.ambience);
    source.start();
    this.addLayer('air', gain, [source, filter, lfo, lfoGain]);
  }

  private addWind(): void {
    const ctx = audio.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = getNoise(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    this.windGain = gain;

    // Two LFOs at incommensurate rates so gusts never fall into a pattern.
    for (const [rate, depth] of [[0.05, 260], [0.017, 420]] as [number, number][]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
    }
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.031;
    const gustGain = ctx.createGain();
    gustGain.gain.value = 0.035;
    gust.connect(gustGain);
    gustGain.connect(gain.gain);
    gust.start();

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio.buses.ambience);
    source.start();
    this.addLayer('wind', gain, [source, filter, gust, gustGain]);
  }

  private addRain(): void {
    const ctx = audio.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = getNoise(ctx);
    source.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 900;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 6200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.rainGain = gain;
    source.connect(high);
    high.connect(low);
    low.connect(gain);
    gain.connect(audio.buses.ambience);
    source.start();
    this.addLayer('rain', gain, [source, high, low]);
  }

  stopAll(): void {
    for (const layer of this.layers.values()) {
      for (const node of layer.nodes) {
        const source = node as OscillatorNode & AudioBufferSourceNode;
        if (typeof source.stop === 'function') {
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
        }
        node.disconnect();
      }
      layer.gain.disconnect();
    }
    this.layers.clear();
    this.windGain = null;
    this.rainGain = null;
    this.hummGain = null;
  }

  /**
   * Sparse punctuation: a distant pipe knock, a creak, a drip. Long gaps are
   * intentional. If something is always happening, nothing is.
   */
  update(dt: number, listener: THREE.Vector3, indoors: boolean, powered: boolean): void {
    if (!audio.ctx) return;
    this.eventTimer -= dt;
    if (this.eventTimer > 0) return;
    this.eventTimer = indoors ? 5 + Math.random() * 16 : 12 + Math.random() * 26;

    const angle = Math.random() * Math.PI * 2;
    const distance = 8 + Math.random() * 22;
    const position = {
      x: listener.x + Math.cos(angle) * distance,
      y: listener.y + (Math.random() - 0.5) * 3,
      z: listener.z + Math.sin(angle) * distance,
    };

    if (indoors) {
      const roll = Math.random();
      if (roll < 0.3) audio.playVariant('rpg-audio-creak', { position, volume: 0.5, rate: 0.6 + Math.random() * 0.3, max: 60 });
      else if (roll < 0.55) audio.playVariant('impact-sounds-impactMetal_light', { position, volume: 0.35, rate: 0.5 + Math.random() * 0.4, max: 70, occluded: true });
      else if (roll < 0.72 && powered) this.electricalArc(position);
      else if (roll < 0.86) this.pipeKnock(position);
      else this.drip(position);
    } else {
      if (Math.random() < 0.4) this.distantGroan(position);
    }
  }

  private pipeKnock(position: { x: number; y: number; z: number }): void {
    const ctx = audio.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const base = 120 + Math.random() * 180;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const panner = spatial(ctx, position, 4, 80);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(audio.buses.ambience);
    panner.connect(audio.reverbSend);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  private drip(position: { x: number; y: number; z: number }): void {
    const ctx = audio.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900 + Math.random() * 700, t);
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    const panner = spatial(ctx, position, 2, 30);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(audio.buses.ambience);
    panner.connect(audio.reverbSend);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private electricalArc(position: { x: number; y: number; z: number }): void {
    const ctx = audio.ctx!;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = getNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600 + Math.random() * 2200;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    for (let i = 0; i < 5; i++) {
      const at = t + i * 0.045;
      gain.gain.setValueAtTime(Math.random() * 0.22, at);
      gain.gain.setValueAtTime(0, at + 0.02);
    }
    const panner = spatial(ctx, position, 3, 40);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(audio.buses.ambience);
    source.start(t);
    source.stop(t + 0.4);
  }

  private distantGroan(position: { x: number; y: number; z: number }): void {
    const ctx = audio.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 52 + Math.random() * 30;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 0.8, t + 2.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.7);
    gain.gain.linearRampToValueAtTime(0.0001, t + 2.6);
    const panner = spatial(ctx, position, 20, 260);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(audio.buses.ambience);
    osc.start(t);
    osc.stop(t + 2.8);
  }
}

// ------------------------------------------------------------ creature voices

export function creatureVoice(
  def: MonsterDef,
  position: { x: number; y: number; z: number },
  aggression: number,
): void {
  const ctx = audio.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  const panner = spatial(ctx, position, 5, def.voice.range);
  panner.connect(audio.buses.sfx);
  panner.connect(audio.reverbSend);

  const out = ctx.createGain();
  out.gain.value = 0.55 + aggression * 0.5;
  out.connect(panner);

  const freq = def.voice.freq * (0.9 + Math.random() * 0.2) * (1 + aggression * 0.25);

  switch (def.voice.timbre) {
    case 'growl': {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq * (0.8 - aggression * 0.15), t + 0.9);
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 14 + aggression * 22;
      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = freq * 0.09;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700 + aggression * 900;
      const env = envelope(ctx, t, 0.08, 0.85, 0.9);
      osc.connect(filter);
      filter.connect(env);
      env.connect(out);
      osc.start(t);
      vibrato.start(t);
      osc.stop(t + 1.1);
      vibrato.stop(t + 1.1);
      break;
    }
    case 'click': {
      const count = 4 + Math.floor(Math.random() * 6);
      for (let i = 0; i < count; i++) {
        const at = t + i * (0.05 + Math.random() * 0.06);
        const source = ctx.createBufferSource();
        source.buffer = getNoise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq * (0.8 + Math.random() * 0.5);
        filter.Q.value = 12;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.5, at + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(out);
        source.start(at);
        source.stop(at + 0.08);
      }
      break;
    }
    case 'wail': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 0.7, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.35, t + 0.6);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 1.9);
      const harmonic = ctx.createOscillator();
      harmonic.type = 'triangle';
      harmonic.frequency.setValueAtTime(freq * 1.51, t);
      harmonic.frequency.exponentialRampToValueAtTime(freq * 0.9, t + 1.9);
      const env = envelope(ctx, t, 0.3, 1.9, 0.5);
      osc.connect(env);
      harmonic.connect(env);
      env.connect(out);
      osc.start(t);
      harmonic.start(t);
      osc.stop(t + 2.1);
      harmonic.stop(t + 2.1);
      break;
    }
    case 'chitter': {
      const count = 8 + Math.floor(Math.random() * 10);
      for (let i = 0; i < count; i++) {
        const at = t + i * (0.028 + Math.random() * 0.04);
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq * (0.7 + Math.random() * 0.9), at);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
        osc.connect(gain);
        gain.connect(out);
        osc.start(at);
        osc.stop(at + 0.06);
      }
      break;
    }
    case 'rumble': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq * 0.72, t + 2.2);
      const grit = ctx.createBufferSource();
      grit.buffer = getNoise(ctx);
      const gritFilter = ctx.createBiquadFilter();
      gritFilter.type = 'lowpass';
      gritFilter.frequency.value = 190;
      const gritGain = ctx.createGain();
      gritGain.gain.value = 0.5;
      const env = envelope(ctx, t, 0.35, 2.2, 1.0);
      osc.connect(env);
      grit.connect(gritFilter);
      gritFilter.connect(gritGain);
      gritGain.connect(env);
      env.connect(out);
      osc.start(t);
      grit.start(t);
      osc.stop(t + 2.6);
      grit.stop(t + 2.6);
      break;
    }
    case 'breath': {
      const source = ctx.createBufferSource();
      source.buffer = getNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 3.2, t);
      filter.frequency.linearRampToValueAtTime(freq * 1.6, t + 1.3);
      filter.Q.value = 1.6;
      const env = envelope(ctx, t, 0.4, 1.3, 0.8);
      source.connect(filter);
      filter.connect(env);
      env.connect(out);
      source.start(t);
      source.stop(t + 1.6);
      break;
    }
    case 'chime': {
      for (const ratio of [1, 2.76, 5.4]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.2 / ratio, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 / ratio);
        osc.connect(gain);
        gain.connect(out);
        osc.start(t);
        osc.stop(t + 2.6);
      }
      break;
    }
  }
}

/** The heavy, wet impact of something connecting with an employee. */
export function impactHit(position: { x: number; y: number; z: number }): void {
  const ctx = audio.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = getNoise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, t);
  filter.frequency.exponentialRampToValueAtTime(180, t + 0.3);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  const panner = spatial(ctx, position, 3, 45);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(panner);
  panner.connect(audio.buses.sfx);
  source.start(t);
  source.stop(t + 0.4);
}

export function thunder(distance: number): void {
  const ctx = audio.ctx;
  if (!ctx) return;
  const delay = Math.min(6, distance / 340 + 0.05);
  const t = ctx.currentTime + delay;
  const source = ctx.createBufferSource();
  source.buffer = getNoise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(120, 2400 - distance * 12), t);
  filter.frequency.exponentialRampToValueAtTime(90, t + 2.6);
  const gain = ctx.createGain();
  const level = Math.max(0.06, 1 - distance / 260);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(level, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(level * 0.4, t + 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.buses.ambience);
  source.start(t);
  source.stop(t + 3.6);
}

/** Heartbeat under stress, and the ring after an explosion. */
export class BodyAudio {
  private beatAt = 0;
  private tinnitus: { osc: OscillatorNode; gain: GainNode } | null = null;

  update(dt: number, stress: number, listener: THREE.Vector3): void {
    const ctx = audio.ctx;
    if (!ctx || stress <= 0.02) return;
    this.beatAt -= dt;
    if (this.beatAt > 0) return;
    const rate = 1.05 - stress * 0.55;
    this.beatAt = rate;

    const t = ctx.currentTime;
    for (const [offset, level] of [[0, 0.5], [0.16, 0.32]] as [number, number][]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(62, t + offset);
      osc.frequency.exponentialRampToValueAtTime(34, t + offset + 0.16);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime(level * stress, t + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.24);
      osc.connect(gain);
      gain.connect(audio.buses.sfx);
      osc.start(t + offset);
      osc.stop(t + offset + 0.3);
    }
  }

  deafen(seconds: number): void {
    const ctx = audio.ctx;
    if (!ctx) return;
    audio.setMuffle(0.85);
    if (!this.tinnitus) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 4200;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(audio.master);
      osc.start();
      this.tinnitus = { osc, gain };
    }
    const t = ctx.currentTime;
    this.tinnitus.gain.gain.cancelScheduledValues(t);
    this.tinnitus.gain.gain.setValueAtTime(0.05, t);
    this.tinnitus.gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    setTimeout(() => audio.setMuffle(0), seconds * 1000);
  }
}

// -------------------------------------------------------------------- utils

function spatial(
  ctx: AudioContext,
  position: { x: number; y: number; z: number },
  ref: number,
  max: number,
): PannerNode {
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = ref;
  panner.maxDistance = max;
  panner.rolloffFactor = 1.1;
  setPannerPosition(panner, position, ctx.currentTime);
  return panner;
}

function envelope(ctx: AudioContext, t: number, attack: number, hold: number, peak: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.linearRampToValueAtTime(0.0001, t + attack + hold);
  return gain;
}

export const ambience = new Ambience();
export const bodyAudio = new BodyAudio();
