import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '@shared/math.ts';
import { MOONS_BY_ID, type MoonDef } from '@shared/content/moons.ts';
import { WEATHER, type WeatherId } from '@shared/content/weather.ts';

/**
 * Renderer, sky, weather and the light budget.
 *
 * The look is deliberately cheap: no post-processing stack, no shadow cascades,
 * one directional light and a small pool of point lights that follow the
 * player. Everything else is fog and darkness, which is both faster and more
 * frightening than anything an expensive pipeline would produce here.
 */

export interface SceneSettings {
  renderScale: number;
  fov: number;
  shadows: boolean;
}

const MAX_DYNAMIC_LIGHTS = 10;

export interface DynamicLight {
  position: THREE.Vector3;
  color: number;
  intensity: number;
  range: number;
  flicker: number;
  /** Facility level, or -1 outdoors. Lights on other levels are never lit. */
  level: number;
  /** Set false to disable without removing (deployed gear, dead batteries). */
  active: boolean;
}

export class SceneManager {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  flashlight: THREE.SpotLight;
  flashlightTarget = new THREE.Object3D();

  sky: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;
  private rain: THREE.Points | null = null;
  private rainVelocity: Float32Array | null = null;
  private water: THREE.Mesh | null = null;

  private pool: THREE.PointLight[] = [];
  private lights: DynamicLight[] = [];
  private lightningFlash = 0;

  private moon: MoonDef | null = null;
  private weather: WeatherId = 'clear';
  private settings: SceneSettings;
  private baseFog = 0.01;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, settings: SceneSettings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * settings.renderScale);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.08, 900);
    this.camera.position.set(0, 1.6, 0);

    this.scene.fog = new THREE.FogExp2(0x0a0d0c, 0.012);
    this.scene.background = new THREE.Color(0x0a0d0c);

    this.ambient = new THREE.AmbientLight(0x66707a, 0.4);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0x5a6a78, 0x201c18, 0.5);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xc8d0d8, 1.1);
    this.sun.position.set(60, 90, 40);
    this.sun.castShadow = settings.shadows;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 4;
    this.sun.shadow.camera.far = 260;
    const s = 70;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // The torch is a child of the camera so it never lags behind the view.
    this.flashlight = new THREE.SpotLight(0xfff0d8, 0, 20, 0.42, 0.55, 1.4);
    this.flashlight.position.set(0.18, -0.1, 0);
    this.flashlight.castShadow = false;
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlightTarget);
    this.flashlightTarget.position.set(0, 0, -1);
    this.flashlight.target = this.flashlightTarget;
    this.scene.add(this.camera);

    this.skyMaterial = makeSkyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), this.skyMaterial);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    for (let i = 0; i < MAX_DYNAMIC_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 12, 1.8);
      light.visible = false;
      this.scene.add(light);
      this.pool.push(light);
    }

    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * this.settings.renderScale);
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  applySettings(settings: Partial<SceneSettings>): void {
    Object.assign(this.settings, settings);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.sun.castShadow = this.settings.shadows;
    this.resize();
  }

  // ---------------------------------------------------------------- weather

  setEnvironment(moonId: string | null, weather: WeatherId): void {
    this.moon = moonId ? MOONS_BY_ID.get(moonId) ?? null : null;
    this.weather = weather;
    const moon = this.moon;
    const w = WEATHER[weather];

    const top = new THREE.Color(moon?.exterior.skyTop ?? 0x1a1e22);
    const bottom = new THREE.Color(moon?.exterior.skyBottom ?? 0x3c4038);
    if (w.flags.permanentNight) {
      top.multiplyScalar(0.22);
      bottom.multiplyScalar(0.3);
    }
    this.skyMaterial.uniforms.topColor.value.copy(top);
    this.skyMaterial.uniforms.bottomColor.value.copy(bottom);

    this.baseFog = (moon?.exterior.fog ?? 0.01) * w.fogMultiplier;
    const fogColor = bottom.clone().lerp(top, 0.45).multiplyScalar(0.85);
    (this.scene.fog as THREE.FogExp2).color.copy(fogColor);
    (this.scene.background as THREE.Color).copy(fogColor);

    const sunColor = new THREE.Color(moon?.exterior.sunColor ?? 0xb8c0c8);
    this.sun.color.copy(sunColor);
    this.hemi.color.copy(top).multiplyScalar(1.4);
    this.hemi.groundColor.copy(bottom).multiplyScalar(0.35);

    this.buildRain(w.flags.precipitation === 'rain' ? 5200 : w.flags.precipitation === 'ash' ? 2600 : 0, w.flags.precipitation);
  }

  /** Called each frame with 0..1 day progress and whether the camera is indoors. */
  updateEnvironment(dayProgress: number, indoors: boolean, dt: number): void {
    this.time += dt;
    const w = WEATHER[this.weather];
    const moon = this.moon;

    // Daylight falls off through the afternoon and is gone entirely by dusk.
    const daylight = w.flags.permanentNight
      ? 0.05
      : clamp(1 - smoothstep(0.42, 0.92, dayProgress), 0.06, 1);
    const light = daylight * w.lightMultiplier;

    const indoorAmbient = 0.055;
    const targetAmbient = indoors ? indoorAmbient : (moon?.exterior.ambient ?? 0.3) * light + 0.02;
    this.ambient.intensity = lerp(this.ambient.intensity, targetAmbient, 1 - Math.exp(-6 * dt));
    this.hemi.intensity = lerp(this.hemi.intensity, indoors ? 0.05 : 0.55 * light, 1 - Math.exp(-6 * dt));
    this.sun.intensity = lerp(this.sun.intensity, indoors ? 0 : 1.25 * light, 1 - Math.exp(-5 * dt));

    // Sun arcs from high-east to low-west across the working day.
    const angle = lerp(-0.15, 1.35, dayProgress);
    this.sun.position.set(Math.cos(angle) * 120, Math.max(6, Math.sin(Math.PI * (1 - dayProgress * 0.85)) * 110), 60);
    this.sun.target.position.copy(this.camera.position);
    this.sun.position.add(this.camera.position);

    const fogTarget = indoors ? Math.max(this.baseFog, 0.055) : this.baseFog * lerp(1, 1.7, 1 - daylight);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = lerp(fog.density, fogTarget, 1 - Math.exp(-3 * dt));

    // Lightning: a short, very bright flash that also lifts the fog colour.
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.4);
      const f = this.lightningFlash ** 2;
      this.renderer.toneMappingExposure = 1 + f * 2.6;
      this.ambient.intensity += f * 1.4;
    } else {
      this.renderer.toneMappingExposure = lerp(this.renderer.toneMappingExposure, indoors ? 1.15 : 1.0, 1 - Math.exp(-4 * dt));
    }

    this.sky.position.copy(this.camera.position);
    this.skyMaterial.uniforms.brightness.value = indoors ? 0.15 : lerp(0.2, 1, light);
    this.updateRain(dt);
  }

  flashLightning(): void {
    this.lightningFlash = 1;
  }

  setFlashlight(on: boolean, range: number, angle: number, intensity: number): void {
    this.flashlight.intensity = on ? intensity * 12 : 0;
    this.flashlight.distance = range;
    this.flashlight.angle = angle;
  }

  // ------------------------------------------------------------------ water

  setWater(level: number | null, size: number): void {
    if (level === null || level < -50) {
      if (this.water) this.water.visible = false;
      return;
    }
    if (!this.water) {
      const geometry = new THREE.PlaneGeometry(size * 3, size * 3, 1, 1);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        color: 0x12201c,
        transparent: true,
        opacity: 0.82,
        roughness: 0.14,
        metalness: 0.5,
      });
      this.water = new THREE.Mesh(geometry, material);
      this.water.renderOrder = 2;
      this.scene.add(this.water);
    }
    this.water.visible = true;
    this.water.position.y = level;
    this.water.position.x = this.camera.position.x;
    this.water.position.z = this.camera.position.z;
  }

  // ------------------------------------------------------------ light pool

  registerLight(light: DynamicLight): DynamicLight {
    this.lights.push(light);
    return light;
  }

  clearLights(): void {
    this.lights.length = 0;
    for (const p of this.pool) p.visible = false;
  }

  removeLight(light: DynamicLight): void {
    const idx = this.lights.indexOf(light);
    if (idx >= 0) this.lights.splice(idx, 1);
  }

  /**
   * Only the nearest handful of lights are real. Everything else contributes
   * nothing, which is exactly what a facility with no power should look like.
   */
  updateLights(cameraLevel: number): void {
    const cam = this.camera.position;
    const candidates = this.lights
      .filter((l) => l.active && (l.level === cameraLevel || l.level === -2))
      .map((l) => ({ l, d: l.position.distanceToSquared(cam) }))
      .filter((c) => c.d < 90 * 90)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_DYNAMIC_LIGHTS);

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      const candidate = candidates[i];
      if (!candidate) {
        slot.visible = false;
        continue;
      }
      const l = candidate.l;
      slot.visible = true;
      slot.position.copy(l.position);
      slot.color.setHex(l.color);
      slot.distance = l.range;
      const flicker =
        l.flicker > 0
          ? 1 - l.flicker * (0.5 + 0.5 * Math.sin(this.time * 21.3 + l.position.x * 3.1)) * Math.random()
          : 1;
      slot.intensity = l.intensity * flicker * 4;
    }
  }

  // ------------------------------------------------------------------- rain

  private buildRain(count: number, kind: 'rain' | 'ash' | 'none' | undefined): void {
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      (this.rain.material as THREE.Material).dispose();
      this.rain = null;
      this.rainVelocity = null;
    }
    if (count <= 0) return;

    const positions = new Float32Array(count * 3);
    const velocity = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 26;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      velocity[i] = kind === 'ash' ? 1.2 + Math.random() * 0.9 : 16 + Math.random() * 10;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: kind === 'ash' ? 0x9a8f80 : 0x9fb4c0,
      size: kind === 'ash' ? 0.09 : 0.055,
      transparent: true,
      opacity: kind === 'ash' ? 0.55 : 0.4,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.rain = new THREE.Points(geometry, material);
    this.rain.frustumCulled = false;
    this.rainVelocity = velocity;
    this.scene.add(this.rain);
  }

  private updateRain(dt: number): void {
    if (!this.rain || !this.rainVelocity) return;
    const positions = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    const drift = Math.sin(this.time * 0.4) * 2.2;
    for (let i = 0; i < this.rainVelocity.length; i++) {
      arr[i * 3 + 1] -= this.rainVelocity[i] * dt;
      arr[i * 3] += drift * dt;
      if (arr[i * 3 + 1] < -4) {
        arr[i * 3] = (Math.random() - 0.5) * 60;
        arr[i * 3 + 1] = 24 + Math.random() * 4;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
      }
    }
    positions.needsUpdate = true;
    this.rain.position.set(this.camera.position.x, this.camera.position.y, this.camera.position.z);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1a1e26) },
      bottomColor: { value: new THREE.Color(0x3c4038) },
      brightness: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float brightness;
      varying vec3 vWorld;

      // Cheap hash for a faint star field; only visible once the light drops.
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      void main() {
        float h = clamp(vWorld.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottomColor, topColor, pow(h, 0.7));
        float star = step(0.9985, hash(floor(vWorld * 320.0)));
        col += star * (1.0 - brightness) * 0.9;
        gl_FragColor = vec4(col * brightness, 1.0);
      }
    `,
  });
}
