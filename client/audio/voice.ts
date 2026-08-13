import * as THREE from 'three';
import { AUDIO } from '@shared/constants.ts';
import { net } from '../net.ts';
import { audio, setPannerPosition } from './engine.ts';

/**
 * Proximity voice over a WebRTC mesh, signalled through the game socket.
 *
 * Distance attenuation is done in Web Audio rather than by the peer connection,
 * so a walkie-talkie can bypass it: hold the radio and your voice arrives at
 * full volume through a deliberately awful band-pass, and also comes out loud
 * at your own position for anything nearby that happens to be listening.
 */

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

interface Peer {
  id: number;
  connection: RTCPeerConnection;
  panner: PannerNode | null;
  gain: GainNode | null;
  radioFilter: BiquadFilterNode | null;
  directGain: GainNode | null;
  element: HTMLAudioElement | null;
  polite: boolean;
  makingOffer: boolean;
}

export class VoiceChat {
  enabled = false;
  transmitting = false;
  onWalkie = false;
  available = false;
  error: string | null = null;

  private stream: MediaStream | null = null;
  private peers = new Map<number, Peer>();
  private micTrack: MediaStreamTrack | null = null;
  private localLevel = 0;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;

  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      this.error = 'Voice chat is not supported in this browser.';
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      this.error = `Microphone unavailable: ${(err as Error).message}`;
      return false;
    }
    this.micTrack = this.stream.getAudioTracks()[0] ?? null;
    if (this.micTrack) this.micTrack.enabled = false;

    // Local level meter, used to drive the "speaking" flag on the network.
    if (audio.ctx && this.stream) {
      const source = audio.ctx.createMediaStreamSource(this.stream);
      this.analyser = audio.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyserData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      source.connect(this.analyser);
    }

    this.enabled = true;
    this.available = true;
    this.error = null;
    return true;
  }

  disable(): void {
    for (const peer of this.peers.values()) peer.connection.close();
    this.peers.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.micTrack = null;
    this.enabled = false;
  }

  setTransmitting(on: boolean, walkie: boolean): void {
    this.transmitting = on;
    this.onWalkie = walkie;
    if (this.micTrack) this.micTrack.enabled = on;
  }

  /** Opens a connection to every other player in the room. */
  syncPeers(): void {
    if (!this.enabled) return;
    const wanted = new Set(net.roster.map((r) => r.id).filter((id) => id !== net.playerId));
    for (const id of wanted) {
      if (!this.peers.has(id)) this.createPeer(id, net.playerId < id);
    }
    for (const [id, peer] of this.peers) {
      if (wanted.has(id)) continue;
      peer.connection.close();
      peer.element?.remove();
      this.peers.delete(id);
    }
  }

  private createPeer(id: number, initiator: boolean): Peer {
    const connection = new RTCPeerConnection(RTC_CONFIG);
    const peer: Peer = {
      id,
      connection,
      panner: null,
      gain: null,
      radioFilter: null,
      directGain: null,
      element: null,
      polite: !initiator,
      makingOffer: false,
    };
    this.peers.set(id, peer);

    if (this.stream) {
      for (const track of this.stream.getTracks()) connection.addTrack(track, this.stream);
    }

    connection.onicecandidate = (ev) => {
      if (ev.candidate) net.send({ t: 'rtc', to: id, payload: { candidate: ev.candidate } });
    };

    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription();
        net.send({ t: 'rtc', to: id, payload: { description: connection.localDescription } });
      } catch {
        /* renegotiation races are expected in a mesh; the polite peer rolls back */
      } finally {
        peer.makingOffer = false;
      }
    };

    connection.ontrack = (ev) => {
      this.attachRemote(peer, ev.streams[0]);
    };

    return peer;
  }

  private attachRemote(peer: Peer, stream: MediaStream): void {
    if (!audio.ctx || peer.panner) return;

    // Chrome needs the stream attached to a media element before Web Audio will
    // pull samples from it. The element itself stays muted.
    const element = document.createElement('audio');
    element.srcObject = stream;
    element.muted = true;
    element.autoplay = true;
    element.play().catch(() => undefined);
    document.body.appendChild(element);
    peer.element = element;

    const source = audio.ctx.createMediaStreamSource(stream);

    const panner = audio.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = AUDIO.voiceFalloffStart;
    panner.maxDistance = AUDIO.voiceRange;
    panner.rolloffFactor = 1.4;

    const proximityGain = audio.ctx.createGain();
    proximityGain.gain.value = 1;

    // Radio path: narrow band-pass plus a touch of distortion-by-clipping.
    const radioFilter = audio.ctx.createBiquadFilter();
    radioFilter.type = 'bandpass';
    radioFilter.frequency.value = 1700;
    radioFilter.Q.value = 1.1;
    const radioGain = audio.ctx.createGain();
    radioGain.gain.value = 0;

    source.connect(panner);
    panner.connect(proximityGain);
    proximityGain.connect(audio.buses.voice);

    source.connect(radioFilter);
    radioFilter.connect(radioGain);
    radioGain.connect(audio.buses.voice);

    peer.panner = panner;
    peer.gain = proximityGain;
    peer.radioFilter = radioFilter;
    peer.directGain = radioGain;
  }

  async handleSignal(from: number, payload: unknown): Promise<void> {
    if (!this.enabled) return;
    let peer = this.peers.get(from);
    if (!peer) peer = this.createPeer(from, net.playerId < from);
    const data = payload as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

    try {
      if (data.description) {
        const offerCollision =
          data.description.type === 'offer' &&
          (peer.makingOffer || peer.connection.signalingState !== 'stable');
        if (offerCollision && !peer.polite) return;
        await peer.connection.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await peer.connection.setLocalDescription();
          net.send({ t: 'rtc', to: from, payload: { description: peer.connection.localDescription } });
        }
      } else if (data.candidate) {
        await peer.connection.addIceCandidate(data.candidate);
      }
    } catch {
      /* a dropped candidate is survivable; the connection retries */
    }
  }

  /**
   * Positions every remote voice each frame and cross-fades between the
   * proximity path and the radio path based on who is holding a walkie.
   */
  update(
    selfPosition: THREE.Vector3,
    selfLevel: number,
    positions: Map<number, { x: number; y: number; z: number; level: number; walkie: boolean }>,
    selfHasWalkie: boolean,
  ): void {
    if (!audio.ctx) return;
    const t = audio.ctx.currentTime;

    for (const peer of this.peers.values()) {
      if (!peer.panner || !peer.gain || !peer.directGain) continue;
      const info = positions.get(peer.id);
      if (!info) {
        peer.gain.gain.setTargetAtTime(0, t, 0.1);
        peer.directGain.gain.setTargetAtTime(0, t, 0.1);
        continue;
      }
      setPannerPosition(peer.panner, info, t);

      // Different level of the facility means no direct sound at all.
      const sameSpace = info.level === selfLevel;
      const distance = Math.hypot(info.x - selfPosition.x, info.z - selfPosition.z);
      const proximity = sameSpace && distance < AUDIO.voiceRange ? 1 : 0;
      const radio = info.walkie && selfHasWalkie ? 1 : 0;

      peer.gain.gain.setTargetAtTime(proximity, t, 0.08);
      // Radio ducks when you can already hear them in the room, so nobody gets
      // the comedy double-voice unless they are genuinely far apart.
      peer.directGain.gain.setTargetAtTime(radio * (proximity > 0 && distance < 8 ? 0.15 : 0.9), t, 0.12);
    }
  }

  /** RMS of the local mic, 0..1, for the speaking indicator. */
  level(): number {
    if (!this.analyser || !this.analyserData || !this.transmitting) {
      this.localLevel *= 0.9;
      return this.localLevel;
    }
    this.analyser.getByteTimeDomainData(this.analyserData);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      const v = (this.analyserData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.analyserData.length);
    this.localLevel = Math.max(rms, this.localLevel * 0.85);
    return this.localLevel;
  }
}

export const voice = new VoiceChat();
