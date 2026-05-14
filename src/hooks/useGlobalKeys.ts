import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { audioEngine } from '../audio/engine';
import { DRUM_PADS } from '../audio/types';

/**
 * Global keyboard control:
 *  - Transport: Space play/pause, Backspace/Enter stop, L loop, K metronome
 *  - Musical: QWERTY rows map to a 1.5-octave keyboard for the selected
 *    instrument track. Z / X shift the octave.
 *  - For drum tracks, A..K trigger the 8 pads.
 */
const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

const DRUM_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export function useGlobalKeys() {
  const octaveRef = useRef(4);
  const heldRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();

      // ----- transport -----
      const st = useStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        (async () => {
          await audioEngine.init();
          if (st.isPlaying) {
            audioEngine.pause();
            st.setPlaying(false);
          } else {
            await audioEngine.play();
            st.setPlaying(true);
          }
        })();
        return;
      }
      if (e.code === 'Enter' || e.code === 'Backspace') {
        e.preventDefault();
        audioEngine.stop();
        st.setPlaying(false);
        st.setPosition(0);
        return;
      }
      if (key === 'l') {
        st.setLoop(!st.project.loopEnabled);
        return;
      }
      if (key === 'm') {
        st.setMetronome(!st.metronome);
        return;
      }
      if (key === 'z') {
        octaveRef.current = Math.max(0, octaveRef.current - 1);
        return;
      }
      if (key === 'x') {
        octaveRef.current = Math.min(8, octaveRef.current + 1);
        return;
      }

      // ----- musical input -----
      if (heldRef.current.has(key)) return; // ignore auto-repeat
      const track =
        st.project.tracks.find((t) => t.id === st.selectedTrackId) ?? st.project.tracks[0];
      if (!track) return;

      if (track.kind === 'drum') {
        const idx = DRUM_KEYS.indexOf(key);
        if (idx >= 0 && idx < DRUM_PADS.length) {
          heldRef.current.add(key);
          audioEngine.trigger(track.id, DRUM_PADS[idx], 0.95, '8n');
        }
        return;
      }

      const semi = KEY_TO_SEMITONE[key];
      if (semi !== undefined) {
        heldRef.current.add(key);
        const midi = octaveRef.current * 12 + 12 + semi;
        audioEngine.trigger(track.id, midi, 0.9, '4n');
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      heldRef.current.delete(e.key.toLowerCase());
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return octaveRef;
}
