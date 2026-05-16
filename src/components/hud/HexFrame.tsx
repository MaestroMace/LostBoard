import React from 'react';

type Variant = 'orange' | 'green' | 'red' | 'soft';

export function HexFrame({
  title,
  children,
  variant = 'orange',
  style,
  className,
}: {
  title?: string;
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
      {title && <div className="hex-frame__title">{title}</div>}
      {children}
    </div>
  );
}
