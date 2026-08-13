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
 * The dev setup runs Vite on one port and the game server on another, so the
 * socket cannot just reuse the page's port. In a production build they are the
 * same origin.
 */
function defaultServer(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const devPorts = ['5180', '5173', '4173'];
  const port = devPorts.includes(location.port) ? '5181' : location.port;
  return `${proto}//${location.hostname}${port ? `:${port}` : ''}`;
}
