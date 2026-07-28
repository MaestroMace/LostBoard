import { memo, type ReactNode } from 'react';
import { useIsMobile } from '../../hooks/useLayoutMode';

/**
 * EditorTip — a thin discoverability strip at the bottom of an editor view.
 * Used by Arrange / Piano Roll / Step Sequencer to keep the wording, padding,
 * font, and divider line identical across views.
 *
 * Hidden on phones. The copy is written around double-click, drag handles and
 * modifier keys — none of which exist on touch — and in landscape the strip
 * costs ~20px of a 411px viewport, which the timeline needs more.
 */
export const EditorTip = memo(function EditorTip({ children }: { children: ReactNode }) {
  if (useIsMobile()) return null;
  return (
    <div
      className="hud-readout--dim hud-readout"
      style={{
        padding: '3px 10px',
        fontSize: 9,
        borderTop: '1px solid rgba(255,106,0,0.25)',
        background: 'rgba(0,0,0,0.5)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      TIP: {children}
    </div>
  );
});
