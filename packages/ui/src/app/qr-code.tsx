import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code as SVG, black on white whatever the theme (scanners need the contrast). */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    return { size: count, path: d };
  }, [text]);
  return (
    <svg viewBox={`-3 -3 ${size + 6} ${size + 6}`} role="img" aria-label={label} className="size-44 rounded-md bg-white" shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  );
}
