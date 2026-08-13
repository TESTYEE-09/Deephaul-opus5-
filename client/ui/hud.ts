import { clockString } from '@shared/constants.ts';
import { WEATHER } from '@shared/content/weather.ts';
import { MOONS_BY_ID, COMPANY } from '@shared/content/moons.ts';
import { SCRAP_BY_ID } from '@shared/content/scrap.ts';
import { EQUIPMENT_BY_ID } from '@shared/content/equipment.ts';
import type { InventorySlot, ShipSnapshot } from '@shared/protocol.ts';
import { net } from '../net.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private logEl = $('log');
  private noticeEl = $('notice');
  private damageEl = $('damage-flash');
  private slotsEl = $('slots');
  private chatLog = $('chat-log');
  private rosterEl = $('roster');
  private scanEl = $('scan-overlay');
  private noticeTimer = 0;
  private damageTimer = 0;
  private logLines: { el: HTMLElement; until: number }[] = [];
  private scanBlips: { el: HTMLElement; x: number; z: number; level: number; until: number }[] = [];

  show(): void {
    $('hud').classList.remove('hidden');
  }

  hide(): void {
    $('hud').classList.add('hidden');
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, ship: ShipSnapshot | null, health: number, stamina: number, carryWeight: number): void {
    if (ship) {
      $('clock').textContent = ship.phase === 'landed' || ship.phase === 'departing' ? clockString(ship.dayProgress) : '--:--';
      const weather = ship.weather ? WEATHER[ship.weather] : null;
      const tag = $('weather-tag');
      tag.textContent = weather ? weather.short : '';
      tag.className = weather ? `sev${weather.severity}` : '';

      const moon = ship.moonId === 'company' ? null : ship.moonId ? MOONS_BY_ID.get(ship.moonId) : null;
      $('moon-tag').textContent =
        ship.phase === 'orbit'
          ? `IN TRANSIT — DAY ${ship.day}`
          : ship.phase === 'company'
            ? COMPANY.code
            : moon
              ? `${moon.code} — DAY ${ship.day}`
              : '';

      const autopilot = $('autopilot');
      if (ship.phase === 'departing') {
        autopilot.classList.remove('hidden');
        autopilot.textContent = `LAUNCHING IN ${Math.ceil(ship.autopilotIn)}`;
      } else if (ship.phase === 'landed' && ship.autopilotIn >= 0 && ship.autopilotIn < 120) {
        autopilot.classList.remove('hidden');
        autopilot.textContent = `AUTOPILOT IN ${Math.ceil(ship.autopilotIn)}s`;
      } else {
        autopilot.classList.add('hidden');
      }

      $('quota-value').textContent = `${ship.quotaMet} / ${ship.quota}`;
      $('credits-value').textContent = String(ship.credits);
      $('cargo-value').textContent = String(ship.cargoValue);
      $('days-value').textContent = `${ship.daysLeft} DAY${ship.daysLeft === 1 ? '' : 'S'}`;
    }

    $('health-fill').style.width = `${Math.max(0, health)}%`;
    $('stamina-fill').style.width = `${Math.max(0, stamina * 100)}%`;

    const carry = $('carry-readout');
    carry.textContent = carryWeight > 0 ? `CARRYING ${carryWeight.toFixed(0)} KG` : '';
    carry.classList.toggle('heavy', carryWeight > 34);

    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0) this.noticeEl.classList.remove('show');
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      this.damageEl.style.opacity = String(Math.max(0, this.damageTimer));
    }

    const now = performance.now();
    for (let i = this.logLines.length - 1; i >= 0; i--) {
      if (this.logLines[i].until < now) {
        this.logLines[i].el.remove();
        this.logLines.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------- inventory

  renderSlots(slots: InventorySlot[], held: number): void {
    this.slotsEl.innerHTML = '';
    slots.forEach((slot, index) => {
      const el = document.createElement('div');
      el.className = 'slot' + (index === held ? ' active' : '') + (slot.twoHanded ? ' two-handed' : '');
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(index + 1);
      el.appendChild(idx);

      if (slot.defId) {
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = itemName(slot);
        el.appendChild(name);

        if (slot.kind === 'scrap' && slot.value > 0) {
          const val = document.createElement('span');
          val.className = 'val';
          val.textContent = `${slot.value}`;
          el.appendChild(val);
        }
        if (slot.weight > 0) {
          const wt = document.createElement('span');
          wt.className = 'wt';
          wt.textContent = `${slot.weight}kg`;
          el.appendChild(wt);
        }
        const equip = slot.defId ? EQUIPMENT_BY_ID.get(slot.defId) : null;
        if (equip && equip.battery > 0) {
          const charge = document.createElement('div');
          charge.className = 'charge';
          charge.style.width = `${Math.round(slot.charge * 100)}%`;
          el.appendChild(charge);
        }
      }
      this.slotsEl.appendChild(el);
    });

    const heldSlot = slots[held];
    const equip = heldSlot?.defId ? EQUIPMENT_BY_ID.get(heldSlot.defId) : null;
    $('battery-readout').textContent =
      equip && equip.battery > 0 ? `${equip.name.toUpperCase()}  ${Math.round(heldSlot.charge * 100)}%` : '';
  }

  setPrompt(text: string | null): void {
    const el = $('interact-prompt');
    el.innerHTML = text ?? '';
  }

  // ------------------------------------------------------------------- feed

  log(text: string, kind: 'info' | 'warn' | 'bad' | 'good' = 'info', seconds = 6): void {
    const el = document.createElement('div');
    el.className = kind === 'info' ? '' : kind;
    el.textContent = text;
    this.logEl.appendChild(el);
    this.logLines.push({ el, until: performance.now() + seconds * 1000 });
    while (this.logLines.length > 7) {
      const oldest = this.logLines.shift();
      oldest?.el.remove();
    }
  }

  notice(text: string, seconds = 3): void {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.add('show');
    this.noticeTimer = seconds;
  }

  flashDamage(amount: number): void {
    this.damageTimer = Math.min(1, this.damageTimer + amount / 60);
    this.damageEl.style.opacity = String(this.damageTimer);
  }

  setGrabbed(grabbed: boolean): void {
    $('grabbed-overlay').classList.toggle('hidden', !grabbed);
  }

  chat(from: string, text: string, channel: 'local' | 'radio' | 'system'): void {
    const el = document.createElement('div');
    el.className = channel;
    if (channel === 'system') {
      el.textContent = text;
    } else {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${from}${channel === 'radio' ? ' [radio]' : ''}:`;
      el.appendChild(who);
      el.appendChild(document.createTextNode(text));
    }
    this.chatLog.appendChild(el);
    while (this.chatLog.childElementCount > 8) this.chatLog.firstElementChild?.remove();
    setTimeout(() => el.remove(), 16000);
  }

  // ----------------------------------------------------------------- roster

  toggleRoster(show: boolean): void {
    this.rosterEl.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = net.roster
      .map((p) => {
        const snap = net.players.get(p.id)?.next;
        const state = snap?.state ?? p.state;
        const where = state !== 'alive' ? 'NO SIGNAL' : (snap?.level ?? -1) >= 0 ? `SUBLEVEL ${snap!.level}` : 'SURFACE';
        const cls = state === 'alive' ? 'ok' : 'dead';
        return `<div class="row"><span>${escapeHtml(p.name)}</span><span class="${cls}">${where}</span><span class="${cls}">${Math.round(snap?.health ?? 0)}%</span></div>`;
      })
      .join('');
    this.rosterEl.innerHTML = `<h3>CREW REGISTER — PING ${Math.round(net.latency)}MS</h3>${rows}`;
  }

  // ------------------------------------------------------------- scanner UI

  addScanBlips(blips: { x: number; z: number; value: number; level: number }[]): void {
    for (const blip of blips) {
      const el = document.createElement('div');
      el.className = 'scan-blip';
      el.textContent = `◆ ${blip.value}`;
      this.scanEl.appendChild(el);
      this.scanBlips.push({ el, x: blip.x, z: blip.z, level: blip.level, until: performance.now() + 6000 });
    }
  }

  /** Projects scanner blips to screen space each frame. */
  updateScanBlips(project: (x: number, z: number, level: number) => { x: number; y: number; visible: boolean }): void {
    const now = performance.now();
    for (let i = this.scanBlips.length - 1; i >= 0; i--) {
      const blip = this.scanBlips[i];
      if (blip.until < now) {
        blip.el.remove();
        this.scanBlips.splice(i, 1);
        continue;
      }
      const p = project(blip.x, blip.z, blip.level);
      blip.el.style.display = p.visible ? 'block' : 'none';
      blip.el.style.left = `${p.x}px`;
      blip.el.style.top = `${p.y}px`;
      blip.el.style.opacity = String(Math.min(1, (blip.until - now) / 1500));
    }
  }

  // -------------------------------------------------------------- spectator

  setSpectating(active: boolean, cause: string, targetName: string): void {
    const el = $('spectator');
    el.classList.toggle('hidden', !active);
    if (!active) return;
    $('spectator-cause').textContent = cause ? `CAUSE OF DEATH: ${cause.toUpperCase()}` : '';
    $('spectator-target').textContent = targetName ? `WATCHING ${targetName.toUpperCase()}` : 'NO SIGNAL';
  }
}

function itemName(slot: InventorySlot): string {
  if (!slot.defId) return '';
  if (slot.kind === 'equipment') return EQUIPMENT_BY_ID.get(slot.defId)?.name ?? slot.defId;
  if (slot.defId === 'body') return 'Crew Body';
  return SCRAP_BY_ID.get(slot.defId)?.name ?? slot.defId;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const hud = new Hud();
