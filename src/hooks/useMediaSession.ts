import { useEffect } from 'react';
import { useStore } from '../state/store';
import { audioEngine } from '../audio/engine';
import { seek } from '../state/transportClock';

/**
 * useMediaSession — wires play / pause / stop on the OS lock-screen, AirPods,
 * Bluetooth headsets, and Android notification controls to the transport.
 *
 * Works on browsers that support `navigator.mediaSession` and trigger it from
 * Web Audio (Android Chrome, desktop Chrome/Edge/Firefox). iOS Safari only
 * surfaces controls when an HTMLMediaElement is also playing; we don't add
 * a silent-audio hack since it has battery cost and the in-app transport is
 * already a one-tap action.
 */
export function useMediaSession() {
  const playing = useStore((s) => s.isPlaying);
  const projectName = useStore((s) => s.project.name);
  const setPlaying = useStore((s) => s.setPlaying);

  // metadata reflects the active project so the lock screen shows useful text
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: projectName || 'LOSTBOARD',
        artist: 'LOSTBOARD // NERV',
        album: 'MAGI SYSTEM',
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
