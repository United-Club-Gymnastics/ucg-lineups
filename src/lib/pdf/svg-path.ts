// Pure: read the absolute-coordinate SVG path commands the UCG mark uses (M L C H V Z) into drawing steps. Shared by the PDF
// renderer (jsPDF vectors) and the preview (an SVG with the same data).
export type PathStep =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

export function parsePath(d: string): PathStep[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: PathStep[] = [];
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': cx = num(); cy = num(); out.push({ op: 'M', x: cx, y: cy }); cmd = 'L'; break;
      case 'L': cx = num(); cy = num(); out.push({ op: 'L', x: cx, y: cy }); break;
      case 'H': cx = num(); out.push({ op: 'L', x: cx, y: cy }); break;
      case 'V': cy = num(); out.push({ op: 'L', x: cx, y: cy }); break;
      case 'C': { const x1 = num(), y1 = num(), x2 = num(), y2 = num(); cx = num(); cy = num(); out.push({ op: 'C', x1, y1, x2, y2, x: cx, y: cy }); break; }
      case 'Z': case 'z': out.push({ op: 'Z' }); cmd = ''; break;
      default: throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  return out;
}
