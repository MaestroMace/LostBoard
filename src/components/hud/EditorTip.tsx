import { memo, type ReactNode } from 'react';

/**
 * EditorTip — a thin discoverability strip at the bottom of an editor view.
 * Used by Arrange / Piano Roll / Step Sequencer to keep the wording, padding,
 * font, and divider line identical across views.
 */
export const EditorTip = memo(function EditorTip({ children }: { children: ReactNode }) {
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
