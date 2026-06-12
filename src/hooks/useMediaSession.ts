import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { audioEngine } from '../audio/engine';
import { seek } from '../state/transportClock';

/**
 * useMediaSession — wires play / pause / stop on the OS lock-screen, AirPods,
 * Bluetooth headsets, and Android notification controls to the transport.
 *
 * Works directly on browsers that surface `navigator.mediaSession` from Web
 * Audio (Android Chrome, desktop Chrome/Edge/Firefox). iOS Safari only
 * surfaces controls when an actual HTMLMediaElement is playing, so we keep a
 * muted looping silent <audio> element and play it alongside the transport —
 * iOS then attaches the MediaSession metadata + action handlers to it. The
 * element is silent and only runs while the transport rolls, so the battery
 * cost is limited to active playback.
 */

/** Build a short silent 16-bit mono WAV as a blob URL, for the iOS keep-alive element. */
function silentWavUrl(seconds = 0.5, sampleRate = 8000): string {
  const numFrames = Math.floor(seconds * sampleRate);
  const dataSize = numFrames * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ws(36, 'data');
  view.setUint32(40, dataSize, true);
  // sample bytes already zero — silent
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export function useMediaSession() {
  const playing = useStore((s) => s.isPlaying);
  const projectName = useStore((s) => s.project.name);
  const setPlaying = useStore((s) => s.setPlaying);
  const keepAlive = useRef<HTMLAudioElement | null>(null);

  // one muted looping silent element — the iOS MediaSession keep-alive
  useEffect(() => {
    const el = document.createElement('audio');
    el.loop = true;
    el.preload = 'auto';
    el.src = silentWavUrl();
    // a hair of volume keeps some iOS versions from ignoring the element;
    // it's a 8 kHz silent buffer so nothing is audible regardless
    el.volume = 0.001;
    keepAlive.current = el;
    return () => {
      el.pause();
      if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src);
      keepAlive.current = null;
    };
  }, []);

  // metadata reflects the active project so the lock screen shows useful text
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: projectName || 'LOSTBOARD',
        artist: 'LOSTBOARD // T.R.I.A.D.',
        album: 'TRIAD SYSTEM',
      });
    } catch {
      // some browsers throw if MediaMetadata isn't constructable
    }
  }, [projectName]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {}
    // drive the iOS keep-alive element in lockstep with the transport
    const el = keepAlive.current;
    if (el) {
      if (playing) {
        el.play().catch(() => {
          /* iOS may reject if too far from a user gesture — controls
             still appear on the next transport start within a gesture */
        });
      } else {
        el.pause();
      }
    }
  }, [playing]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', async () => {
      await audioEngine.init();
      await audioEngine.play();
      setPlaying(true);
    });
    ms.setActionHandler('pause', () => {
      audioEngine.pause();
      setPlaying(false);
    });
    ms.setActionHandler('stop', () => {
      audioEngine.stop();
      setPlaying(false);
      seek(0);
    });
    return () => {
      ms.setActionHandler('play', null);
      ms.setActionHandler('pause', null);
      ms.setActionHandler('stop', null);
    };
  }, [setPlaying]);
}
