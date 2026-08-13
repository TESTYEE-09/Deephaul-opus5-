import * as THREE from 'three';
import { assets } from '../assets.ts';

/**
 * Audio.
 *
 * Two sources: CC0 samples for anything percussive and specific (footsteps,
 * impacts, doors, terminal beeps) and live synthesis for everything continuous
 * or creature-shaped. Ambience is never a looping wav — it is generated, so it
 * never repeats and never sounds like a file.
 */

export interface PlayOptions {
  position?: THREE.Vector3 | { x: number; y: number; z: number };
  volume?: number;
  rate?: number;
  /** Max audible distance. */
  ref?: number;
  max?: number;
  bus?: 'sfx' | 'ui' | 'ambience' | 'voice';
  /** Occluded sources are low-passed rather than silenced. */
  occluded?: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  buses!: Record<'sfx' | 'ui' | 'ambience' | 'voice', GainNode>;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private started = false;
  private muffle!: BiquadFilterNode;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    // A gentle global low-pass that we close down when the player is deafened
    // or underwater. Cheap, and it does an enormous amount for atmosphere.
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.6;

    this.master.connect(this.muffle);
    this.muffle.connect(ctx.destination);

    this.buses = {
      sfx: ctx.createGain(),
      ui: ctx.createGain(),
      ambience: ctx.createGain(),
      voice: ctx.createGain(),
    };
    for (const bus of Object.values(this.buses)) bus.connect(this.master);
    this.buses.ambience.gain.value = 0.75;
    this.buses.ui.gain.value = 0.5;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulseResponse(ctx, 2.4, 3.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    if (ctx.listener.forwardX) {
      ctx.listener.forwardX.value = 0;
      ctx.listener.forwardY.value = 0;
      ctx.listener.forwardZ.value = -1;
      ctx.listener.upY.value = 1;
    }
    await ctx.resume();
  }

  setMasterVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  setVoiceVolume(v: number): void {
    if (this.buses) this.buses.voice.gain.value = v;
  }

  /** Interior spaces get long reverb, outdoors gets almost none. */
  setSpace(kind: 'interior' | 'exterior' | 'ship'): void {
    if (!this.ctx) return;
    const target = kind === 'interior' ? 0.5 : kind === 'ship' ? 0.16 : 0.05;
    this.reverbSend.gain.setTargetAtTime(target, this.ctx.currentTime, 0.7);
  }

  /** 0 = normal hearing, 1 = fully muffled (deafened, underwater). */
  setMuffle(amount: number): void {
    if (!this.ctx) return;
    const freq = 20000 * (1 - amount) ** 2 + 320 * amount;
    this.muffle.frequency.setTargetAtTime(Math.max(280, freq), this.ctx.currentTime, 0.12);
  }

  updateListener(camera: THREE.PerspectiveCamera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = camera.position;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(
        forward.x, forward.y, forward.z, up.x, up.y, up.z,
      );
    }
  }

  // ------------------------------------------------------------- sample bank

  async loadSample(id: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id);
    if (cached) return cached;
    const pending = this.loading.get(id);
    if (pending) return pending;

    const url = assets.audioUrl(id);
    if (!url || !this.ctx) return null;
    const promise = (async () => {
      try {
        const res = await fetch(url);
        const data = await res.arrayBuffer();
        const buffer = await this.ctx!.decodeAudioData(data);
        this.buffers.set(id, buffer);
        return buffer;
      } catch {
        return null;
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, promise);
    return promise;
  }

  async preload(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.loadSample(id)));
  }

  play(id: string, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      void this.loadSample(id).then((b) => {
        if (b) this.playBuffer(b, options);
      });
      return;
    }
    this.playBuffer(buffer, options);
  }

  playBuffer(buffer: AudioBuffer, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;

    const gain = ctx.createGain();
    gain.gain.value = options.volume ?? 1;

    let tail: AudioNode = gain;
    if (options.occluded) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      gain.connect(filter);
      tail = filter;
    }

    const bus = this.buses[options.bus ?? 'sfx'];
    if (options.position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = options.ref ?? 3;
      panner.maxDistance = options.max ?? 90;
      panner.rolloffFactor = 1.15;
      setPannerPosition(panner, options.position, ctx.currentTime);
      tail.connect(panner);
      panner.connect(bus);
      panner.connect(this.reverbSend);
    } else {
      tail.connect(bus);
    }

    source.connect(gain);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }

  /** Picks one of a family of samples at random, e.g. footstep_concrete_00N. */
  playVariant(prefix: string, options: PlayOptions = {}): void {
    const matches = assets.audioMatching(new RegExp(`^${escapeRegex(prefix)}`));
    if (!matches.length) return;
    this.play(matches[Math.floor(Math.random() * matches.length)], options);
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }
}

export function setPannerPosition(
  panner: PannerNode,
  position: { x: number; y: number; z: number },
  time: number,
): void {
  if (panner.positionX) {
    panner.positionX.setValueAtTime(position.x, time);
    panner.positionY.setValueAtTime(position.y, time);
    panner.positionZ.setValueAtTime(position.z, time);
  } else {
    (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
      position.x,
      position.y,
      position.z,
    );
  }
}

/** Noise-burst impulse response: a convincing concrete-corridor tail for free. */
function makeImpulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Early reflections plus an exponential tail.
      const early = i < rate * 0.05 ? (Math.random() * 2 - 1) * 0.7 : 0;
      data[i] = ((Math.random() * 2 - 1) * (1 - t) ** decay + early) * 0.6;
    }
  }
  return impulse;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const audio = new AudioEngine();

/** Sound ids the game reaches for constantly, worth having decoded up front. */
export const CORE_SOUNDS = [
  'impact-sounds-footstep_concrete_000',
  'impact-sounds-footstep_concrete_001',
  'impact-sounds-footstep_concrete_002',
  'impact-sounds-footstep_concrete_003',
  'impact-sounds-footstep_concrete_004',
  'impact-sounds-footstep_grass_000',
  'impact-sounds-footstep_grass_001',
  'impact-sounds-footstep_grass_002',
  'impact-sounds-footstep_grass_003',
  'impact-sounds-footstep_grass_004',
  'impact-sounds-impactMetal_light_000',
  'impact-sounds-impactMetal_medium_000',
  'impact-sounds-impactMetal_heavy_000',
  'impact-sounds-impactGlass_light_000',
  'impact-sounds-impactGeneric_light_000',
  'impact-sounds-impactBell_heavy_000',
  'impact-sounds-impactMining_000',
  'sci-fi-sounds-doorOpen_000',
  'sci-fi-sounds-doorClose_000',
  'sci-fi-sounds-computerNoise_000',
  'sci-fi-sounds-explosionCrunch_000',
  'sci-fi-sounds-forceField_000',
  'sci-fi-sounds-lowFrequency_explosion_000',
  'interface-sounds-click_001',
  'interface-sounds-confirmation_001',
  'interface-sounds-error_002',
  'interface-sounds-drop_003',
  'rpg-audio-creak1',
  'rpg-audio-creak2',
  'rpg-audio-creak3',
  'rpg-audio-doorOpen_1',
  'rpg-audio-doorClose_1',
  'rpg-audio-cloth1',
];
