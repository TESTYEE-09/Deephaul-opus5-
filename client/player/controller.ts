import * as THREE from 'three';
import { PLAYER, carrySpeedFactor, carryStaminaFactor } from '@shared/constants.ts';
import { clamp, damp, lerp } from '@shared/math.ts';
import {
  FLAG_AIRBORNE,
  FLAG_CROUCH,
  FLAG_GRABBED,
  FLAG_LIGHT,
  FLAG_SPRINT,
  FLAG_WALKIE,
} from '@shared/protocol.ts';
import type { WorldCollision } from './collision.ts';

export interface InputState {
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
}

export interface ControllerEvents {
  onLand: (impactSpeed: number) => void;
  onStep: (running: boolean, crouching: boolean) => void;
  onJump: () => void;
}

/**
 * First-person movement. Deliberately a bit heavy: acceleration, real inertia,
 * stamina that punishes panic sprinting, and carry weight that turns a good
 * haul into a liability. Players should feel like badly equipped labourers, not
 * like they are piloting a mech.
 */
export class PlayerController {
  position = new THREE.Vector3(0, 2, 0);
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  level = -1;
  grounded = true;
  crouching = false;
  sprinting = false;
  stamina = 1;
  exhaustedUntil = 0;
  lightOn = false;
  walkieOpen = false;
  grabbed = false;
  carryWeight = 0;
  /** Camera height above `position`, animated for crouch and bob. */
  eyeHeight: number = PLAYER.eyeHeight;
  frozen = false;

  private bobPhase = 0;
  private stepDistance = 0;
  private fallStart = 0;
  private lastGrounded = true;
  private headBobEnabled = true;
  private shake = 0;
  private shakeDecay = 3;
  private time = 0;

  constructor(
    private collision: WorldCollision,
    private events: ControllerEvents,
  ) {}

  setHeadBob(enabled: boolean): void {
    this.headBobEnabled = enabled;
  }

  addShake(amount: number, decay = 3): void {
    this.shake = Math.min(1.2, this.shake + amount);
    this.shakeDecay = decay;
  }

  look(dx: number, dy: number, sensitivity: number): void {
    if (this.frozen) return;
    this.yaw -= dx * 0.0022 * sensitivity;
    this.pitch = clamp(this.pitch - dy * 0.0022 * sensitivity, -1.45, 1.45);
    while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  teleportTo(x: number, y: number, z: number, level: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.level = level;
    this.grounded = true;
    this.fallStart = y;
  }

  update(dt: number, input: InputState, alive: boolean): void {
    this.time += dt;
    if (!alive) {
      this.velocity.set(0, 0, 0);
      return;
    }

    const held = this.grabbed || this.frozen;
    const wantCrouch = input.crouch && !held;
    const ceiling = this.collision.ceilingHeight(this.position.x, this.position.z, this.level);
    const headroom = ceiling - this.position.y;
    // Cannot stand back up under a low ceiling.
    this.crouching = wantCrouch || (this.crouching && headroom < PLAYER.height + 0.15);

    const moveInput = held ? { forward: 0, strafe: 0 } : { forward: input.forward, strafe: input.strafe };
    const moving = Math.abs(moveInput.forward) > 0.01 || Math.abs(moveInput.strafe) > 0.01;

    const canSprint =
      input.sprint && moving && !this.crouching && this.stamina > 0.02 && this.time > this.exhaustedUntil && !held;
    this.sprinting = canSprint;

    // ---- stamina
    const weightFactor = carryStaminaFactor(this.carryWeight);
    if (this.sprinting) {
      this.stamina -= PLAYER.staminaDrainSprint * weightFactor * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhaustedUntil = this.time + PLAYER.staminaExhaustLockout;
      }
    } else {
      const regen = moving ? PLAYER.staminaRegenMoving : PLAYER.staminaRegen;
      this.stamina = Math.min(1, this.stamina + (regen / Math.max(1, weightFactor * 0.6)) * dt);
    }

    // ---- desired horizontal velocity
    const speedCap =
      (this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed) *
      carrySpeedFactor(this.carryWeight) *
      (moveInput.forward < 0 ? PLAYER.backpedalFactor : 1);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wishX = sin * moveInput.forward + cos * moveInput.strafe;
    let wishZ = cos * moveInput.forward - sin * moveInput.strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    const accel = this.grounded ? PLAYER.accelGround : PLAYER.accelAir;
    const targetX = wishX * speedCap;
    const targetZ = wishZ * speedCap;
    const control = this.grounded ? 1 : PLAYER.airControl;
    this.velocity.x += (targetX - this.velocity.x) * Math.min(1, accel * control * dt);
    this.velocity.z += (targetZ - this.velocity.z) * Math.min(1, accel * control * dt);

    if (this.grounded && !moving) {
      const friction = Math.max(0, 1 - PLAYER.friction * dt);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
    }

    // ---- jump
    if (input.jump && this.grounded && !this.crouching && !held && this.stamina > PLAYER.staminaDrainJump) {
      this.velocity.y = PLAYER.jumpVelocity;
      this.stamina -= PLAYER.staminaDrainJump * weightFactor;
      this.grounded = false;
      this.fallStart = this.position.y;
      this.events.onJump();
    }

    // ---- gravity and vertical integration
    this.velocity.y = Math.max(-PLAYER.maxFallSpeed, this.velocity.y - PLAYER.gravity * dt);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.collision.resolve(this.position, this.level);

    this.position.y += this.velocity.y * dt;
    const ground = this.collision.groundHeight(this.position.x, this.position.z, this.level);
    const ceil = this.collision.ceilingHeight(this.position.x, this.position.z, this.level);

    if (this.position.y <= ground) {
      const impact = -this.velocity.y;
      this.position.y = ground;
      this.velocity.y = 0;
      if (!this.lastGrounded) this.events.onLand(impact);
      this.grounded = true;
    } else {
      if (this.grounded) this.fallStart = this.position.y;
      this.grounded = false;
    }
    const standing = this.crouching ? PLAYER.crouchHeight : PLAYER.height;
    if (this.position.y + standing > ceil) {
      this.position.y = ceil - standing;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
    this.lastGrounded = this.grounded;

    // ---- footstep cadence
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && horizontalSpeed > 0.4) {
      this.stepDistance += horizontalSpeed * dt;
      const stride = this.crouching ? 1.35 : this.sprinting ? 2.05 : 1.7;
      if (this.stepDistance >= stride) {
        this.stepDistance = 0;
        this.events.onStep(this.sprinting, this.crouching);
      }
      this.bobPhase += horizontalSpeed * dt * (this.sprinting ? 5.6 : 4.4);
    } else {
      this.stepDistance = Math.max(0, this.stepDistance - dt);
      this.bobPhase = damp(this.bobPhase % (Math.PI * 2), 0, 6, dt);
    }

    // ---- camera height
    const targetEye = this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this.eyeHeight = damp(this.eyeHeight, targetEye, 11, dt);

    this.shake = Math.max(0, this.shake - this.shakeDecay * dt);
  }

  /** Writes the final camera transform, including bob and shake. */
  applyCamera(camera: THREE.PerspectiveCamera): void {
    const bobAmount = this.headBobEnabled ? (this.sprinting ? 0.075 : 0.045) : 0;
    const speedFactor = clamp(Math.hypot(this.velocity.x, this.velocity.z) / PLAYER.walkSpeed, 0, 1.4);
    const bobY = Math.sin(this.bobPhase * 2) * bobAmount * speedFactor;
    const bobX = Math.cos(this.bobPhase) * bobAmount * 0.75 * speedFactor;
    const shakeX = (Math.random() - 0.5) * this.shake * 0.09;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.09;

    camera.position.set(
      this.position.x + bobX + shakeX,
      this.position.y + this.eyeHeight + bobY + shakeY,
      this.position.z,
    );
    camera.rotation.order = 'YXZ';
    // The whole codebase treats a heading as (sin a, cos a) - monsters, dropped
    // items, entrance markers and remote player models all use it. Three.js
    // cameras look down local -Z, which is the opposite, so the camera picks up
    // the half turn rather than every other system picking up a minus sign.
    camera.rotation.y = this.yaw + Math.PI;
    camera.rotation.x = this.pitch;
    // A slight roll while strafing sells the weight of the body.
    camera.rotation.z = lerp(camera.rotation.z, -this.velocity.x * 0.004 * Math.cos(this.yaw), 0.12) + this.shake * 0.02;
  }

  flags(speaking: boolean): number {
    let flags = 0;
    if (this.crouching) flags |= FLAG_CROUCH;
    if (this.sprinting) flags |= FLAG_SPRINT;
    if (!this.grounded) flags |= FLAG_AIRBORNE;
    if (this.lightOn) flags |= FLAG_LIGHT;
    if (speaking) flags |= 16;
    if (this.grabbed) flags |= FLAG_GRABBED;
    if (this.walkieOpen) flags |= FLAG_WALKIE;
    return flags;
  }

  /** Metres fallen since leaving the ground, for fall damage. */
  fallDistance(): number {
    return Math.max(0, this.fallStart - this.position.y);
  }
}
