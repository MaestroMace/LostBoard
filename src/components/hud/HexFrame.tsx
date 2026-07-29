import React from 'react';

type Variant = 'orange' | 'green' | 'red' | 'soft';

export function HexFrame({
  title,
  action,
  children,
  variant = 'orange',
  style,
  className,
}: {
  title?: string;
  /** Optional control pinned to the right of the title row — an on/off
   *  toggle belongs beside its section name, not on a full-width row of
   *  its own that costs 44px of height per panel. */
  action?: React.ReactNode;
  children: React.ReactNode;
  variant?: Variant;
  style?: React.CSSProperties;
  className?: string;
}) {
  const cls = [
    'hex-frame',
    variant === 'green' && 'hex-frame--green',
    variant === 'red' && 'hex-frame--red',
    variant === 'soft' && 'hex-frame--soft',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={style}>
      {(title || action) && (
        <div className="hex-frame__title">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
