import { TILE } from '@shared/constants.ts';
import { cellIndex, isFloor, type FacilityLayout } from '@shared/facility/types.ts';
import { net } from '../net.ts';
import { audio } from '../audio/engine.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** The ship terminal: a text screen and nothing else, on purpose. */
export class TerminalScreen {
  open = false;
  private out = $<HTMLPreElement>('terminal-out');
  private input = $<HTMLInputElement>('terminal-input');
  private history: string[] = [];
  private historyIndex = -1;
  private buffer: string[] = [];

  constructor(private onSubmit: (line: string) => void, private onClose: () => void) {
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const line = this.input.value.trim();
        this.input.value = '';
        if (!line) return;
        this.history.unshift(line);
        this.historyIndex = -1;
        this.onSubmit(line);
        audio.play('interface-sounds-click_001', { bus: 'ui', volume: 0.4 });
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (this.historyIndex < this.history.length - 1) this.historyIndex++;
        this.input.value = this.history[this.historyIndex] ?? '';
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        this.historyIndex = Math.max(-1, this.historyIndex - 1);
        this.input.value = this.historyIndex < 0 ? '' : this.history[this.historyIndex];
      } else if (ev.key === 'Escape') {
        this.close();
      }
      ev.stopPropagation();
    });
  }

  show(): void {
    this.open = true;
    $('terminal').classList.remove('hidden');
    this.input.focus();
    audio.play('sci-fi-sounds-computerNoise_000', { bus: 'ui', volume: 0.35 });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    $('terminal').classList.add('hidden');
    this.input.blur();
    this.onClose();
  }

  write(lines: string[], clear = false): void {
    if (clear) this.buffer = [];
    this.buffer.push(...lines);
    while (this.buffer.length > 400) this.buffer.shift();
    this.out.textContent = this.buffer.join('\n');
    this.out.scrollTop = this.out.scrollHeight;
  }
}

/**
 * The site monitor. Deliberately a bad picture: coarse, delayed, and unable to
 * tell a crewmate from something wearing a crewmate's transponder.
 */
export class MonitorScreen {
  open = false;
  private canvas = $<HTMLCanvasElement>('monitor-canvas');
  private ctx = this.canvas.getContext('2d')!;
  private layout: FacilityLayout | null = null;
  private sweep = 0;

  constructor(private onClose: () => void) {}

  setLayout(layout: FacilityLayout | null): void {
    this.layout = layout;
  }

  show(): void {
    this.open = true;
    $('monitor').classList.remove('hidden');
    audio.play('sci-fi-sounds-forceField_000', { bus: 'ui', volume: 0.3 });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    $('monitor').classList.add('hidden');
    this.onClose();
  }

  update(dt: number, shipX: number, shipZ: number, exteriorSize: number): void {
    if (!this.open) return;
    this.sweep = (this.sweep + dt * 0.55) % (Math.PI * 2);
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#04100a';
    ctx.fillRect(0, 0, w, h);

    // Two plots side by side: surface on the left, facility on the right.
    const half = w / 2;
    this.drawSurface(ctx, 0, 0, half, h, shipX, shipZ, exteriorSize);
    this.drawFacility(ctx, half, 0, half, h);

    ctx.strokeStyle = 'rgba(111,194,122,0.35)';
    ctx.beginPath();
    ctx.moveTo(half, 8);
    ctx.lineTo(half, h - 8);
    ctx.stroke();

    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(111,194,122,0.7)';
    ctx.fillText('SURFACE', 10, 16);
    ctx.fillText('FACILITY', half + 10, 16);

    this.renderCrewList();
  }

  private drawSurface(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    w: number,
    h: number,
    shipX: number,
    shipZ: number,
    size: number,
  ): void {
    const scale = Math.min(w, h) / (size * 2.2);
    const cx = ox + w / 2;
    const cy = oy + h / 2;

    ctx.strokeStyle = 'rgba(111,194,122,0.12)';
    ctx.lineWidth = 1;
    for (let r = 40; r <= size; r += 40) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sweep line, purely so the thing looks like it is working.
    ctx.strokeStyle = 'rgba(111,194,122,0.25)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.sweep) * w * 0.5, cy + Math.sin(this.sweep) * h * 0.5);
    ctx.stroke();

    ctx.fillStyle = '#d8a83c';
    ctx.fillRect(cx - 4, cy - 4, 8, 8);
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('SHIP', cx + 7, cy + 3);

    for (const blip of net.radar) {
      if (blip.level >= 0) continue;
      const bx = cx + (blip.x - shipX) * scale;
      const by = cy + (blip.z - shipZ) * scale;
      this.drawBlip(ctx, bx, by, blip.kind, blip.name);
    }
  }

  private drawFacility(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
    const layout = this.layout;
    if (!layout) {
      ctx.fillStyle = 'rgba(111,194,122,0.4)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('NO STRUCTURE ON FILE', ox + 20, oy + h / 2);
      return;
    }

    // Show the level most of the crew is standing on.
    const counts = new Map<number, number>();
    for (const blip of net.radar) {
      if (blip.level < 0) continue;
      counts.set(blip.level, (counts.get(blip.level) ?? 0) + 1);
    }
    let level = 0;
    let best = -1;
    for (const [l, c] of counts) if (c > best) { best = c; level = l; }
    const grid = layout.levels[level];
    if (!grid) return;

    const scale = Math.min((w - 30) / grid.w, (h - 40) / grid.d);
    const gx = ox + 16;
    const gy = oy + 26;

    ctx.fillStyle = 'rgba(111,194,122,0.16)';
    for (let z = 0; z < grid.d; z++) {
      for (let x = 0; x < grid.w; x++) {
        if (!isFloor(grid, x, z)) continue;
        ctx.fillRect(gx + x * scale, gy + z * scale, Math.max(1, scale - 0.6), Math.max(1, scale - 0.6));
      }
    }

    // Doors the operator can actually work are marked.
    ctx.fillStyle = 'rgba(216,168,60,0.85)';
    for (const door of layout.doors) {
      if (door.level !== level || door.kind !== 'powered') continue;
      const state = net.doors.get(door.id);
      ctx.fillStyle = state?.state === 1 ? 'rgba(111,194,122,0.9)' : 'rgba(216,168,60,0.9)';
      ctx.fillRect(gx + door.x * scale + scale * 0.25, gy + door.z * scale + scale * 0.25, scale * 0.5, scale * 0.5);
    }

    ctx.fillStyle = 'rgba(255,120,60,0.9)';
    for (const spec of layout.doors) {
      if (spec.level !== level) continue;
      if (spec.kind !== 'main' && spec.kind !== 'fire') continue;
      ctx.fillRect(gx + spec.x * scale, gy + spec.z * scale, Math.max(2, scale), Math.max(2, scale));
    }

    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(111,194,122,0.6)';
    ctx.fillText(`LEVEL ${level}`, ox + 16, oy + 18);

    for (const blip of net.radar) {
      if (blip.level !== level) continue;
      const bx = gx + (blip.x - 20000) / TILE * scale;
      const by = gy + (blip.z / TILE) * scale;
      this.drawBlip(ctx, bx, by, blip.kind, blip.name);
    }
  }

  private drawBlip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    kind: string,
    name?: string,
  ): void {
    if (kind === 'unknown') {
      ctx.fillStyle = 'rgba(210,84,58,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = kind === 'ghost' ? 'rgba(127,176,216,0.9)' : 'rgba(111,194,122,0.95)';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (name) {
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(name.slice(0, 10).toUpperCase(), x + 6, y + 3);
    }
  }

  private renderCrewList(): void {
    const el = $('monitor-crew');
    el.innerHTML = net.roster
      .map((p) => {
        const snap = net.players.get(p.id)?.next;
        const dead = !snap || snap.state !== 'alive';
        const where = dead ? 'NO SIGNAL' : (snap.level ?? -1) >= 0 ? `L${snap.level}` : 'SURF';
        return `<span class="${dead ? 'lost' : ''}">${p.name.toUpperCase()} ${where} ${dead ? '' : Math.round(snap.health) + '%'}</span>`;
      })
      .join('');
  }
}
