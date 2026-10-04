// Shuffle play over a folder of music (or a pile of dropped files): one ride after another, for a
// party or a club screen. The folder is read where it is, on the user's machine; nothing is copied
// or uploaded. Where the browser can (Chrome, Edge), the folder is remembered so the next visit can
// shuffle it again with one click.

const AUDIO = /\.(mp3|wav|flac|ogg|oga|opus|m4a|mp4|aac|webm)$/i;
export const isAudio = (name: string) => AUDIO.test(name);

export interface Track { name: string; get(): Promise<File> }

export class Playlist {
  private order: number[] = [];
  private pos = -1;

  constructor(readonly name: string, readonly tracks: Track[]) { this.reshuffle(); }

  get size() { return this.tracks.length; }
  /** 1-based position in this round of the shuffle. */
  get index() { return this.pos + 1; }

  /** The next track, reshuffling once every track has played (never the same one twice in a row). */
  next(): Track {
    if (++this.pos >= this.order.length) {
      const last = this.order[this.order.length - 1];
      this.reshuffle();
      if (this.order.length > 1 && this.order[0] === last) [this.order[0], this.order[1]] = [this.order[1], this.order[0]];
      this.pos = 0;
    }
    return this.tracks[this.order[this.pos]];
  }

  /** What comes after the current track, without moving on. */
  peek(): Track | null {
    if (!this.tracks.length) return null;
    return this.pos + 1 < this.order.length ? this.tracks[this.order[this.pos + 1]] : null;
  }

  private reshuffle() {
    this.order = this.tracks.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
  }

  static fromFiles(files: File[], name = 'your files'): Playlist {
    return new Playlist(name, files.filter(f => isAudio(f.name)).map(f => ({ name: f.name, get: async () => f })));
  }

  /** Every audio file in a folder and its subfolders (up to a sensible limit). */
  static async fromDirectory(dir: FileSystemDirectoryHandle): Promise<Playlist> {
    const tracks: Track[] = [];
    const walk = async (d: FileSystemDirectoryHandle, depth: number) => {
      for await (const h of (d as any).values() as AsyncIterable<FileSystemHandle>) {
        if (tracks.length >= 20000) return;
        if (h.kind === 'file' && isAudio(h.name)) { const fh = h as FileSystemFileHandle; tracks.push({ name: h.name, get: () => fh.getFile() }); }
        else if (h.kind === 'directory' && depth < 8 && !h.name.startsWith('.')) await walk(h as FileSystemDirectoryHandle, depth + 1);
      }
    };
    await walk(dir, 0);
    return new Playlist(dir.name, tracks);
  }
}

/** True where the browser can open a folder and remember it (the File System Access API). */
export const canPickFolder = () => typeof (window as any).showDirectoryPicker === 'function';

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try { return await (window as any).showDirectoryPicker({ id: 'gondryator-music', mode: 'read' }); }
  catch { return null; } // cancelled
}

// The remembered folder lives in its own small IndexedDB store (handles can be stored, not paths).
const DB = 'gondryator-folders';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('folders');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function rememberFolder(dir: FileSystemDirectoryHandle) {
  try { const d = await db(); d.transaction('folders', 'readwrite').objectStore('folders').put(dir, 'last'); } catch { /* private window */ }
}

export async function lastFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const d = await db();
    return await new Promise(resolve => {
      const r = d.transaction('folders').objectStore('folders').get('last');
      r.onsuccess = () => resolve((r.result as FileSystemDirectoryHandle) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/** Asks again for read access to a remembered folder (needs a click). */
export async function regainAccess(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const h = dir as any;
  try {
    if ((await h.queryPermission?.({ mode: 'read' })) === 'granted') return true;
    return (await h.requestPermission?.({ mode: 'read' })) === 'granted';
  } catch { return false; }
}
