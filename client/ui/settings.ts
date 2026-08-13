export interface Settings {
  name: string;
  room: string;
  server: string;
  skin: number;
  sensitivity: number;
  volume: number;
  voiceVolume: number;
  renderScale: number;
  fov: number;
  microphone: boolean;
  shadows: boolean;
  headBob: boolean;
}

const KEY = 'deephaul.settings.v1';

const DEFAULTS: Settings = {
  name: '',
  room: 'default',
  server: '',
  skin: 0,
  sensitivity: 1,
  volume: 0.85,
  voiceVolume: 1,
  renderScale: 1,
  fov: 82,
  microphone: false,
  shadows: true,
  headBob: true,
};

export function loadSettings(): Settings {
  const defaults: Settings = { ...DEFAULTS, server: defaultServer() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private browsing; settings simply will not persist */
  }
}

/**
 * Empty means solo: the authoritative server runs in a web worker inside the
 * tab, which is how the game works on static hosting (GitHub Pages). Anyone
 * running the Node server can still type its address here to play together.
 */
function defaultServer(): string {
  return '';
}
