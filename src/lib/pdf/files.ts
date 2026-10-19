// Make the downloadable files from export inputs: one PDF for a session, one PDF for every session, or a zip with one PDF each.
// The jsPDF renderer and JSZip are loaded on demand so they stay out of the main bundle.
import { allSessionsFileName, collate, sessionFileName, sessionPages, type ExportKind, type SessionExportInput } from './collate';

export interface PdfFile {
  name: string;
  bytes: ArrayBuffer;
}

export async function sessionPdf(kind: ExportKind, session: SessionExportInput, printedOn: string): Promise<PdfFile> {
  const { pdfBytes } = await import('./render');
  return { name: sessionFileName(kind, session), bytes: pdfBytes(sessionPages(kind, session, printedOn), sessionFileName(kind, session)) };
}

/** Every session in one PDF, collated for printing (scorecards by location, rotation sheets by session name). */
export async function allSessionsPdf(kind: ExportKind, sessions: SessionExportInput[], gymOrder: string[] | undefined, printedOn: string): Promise<PdfFile> {
  const { pdfBytes } = await import('./render');
  const name = allSessionsFileName(kind, 'pdf');
  const pages = collate(kind, sessions, gymOrder, printedOn).flatMap((d) => d.pages);
  return { name, bytes: pdfBytes(pages, name) };
}

/** A zip with one PDF per session, in collation order, ready to post on the web. */
export async function allSessionsZip(kind: ExportKind, sessions: SessionExportInput[], gymOrder: string[] | undefined, printedOn: string): Promise<{ name: string; bytes: Blob }> {
  const [{ pdfBytes }, { default: JSZip }] = await Promise.all([import('./render'), import('jszip')]);
  const zip = new JSZip();
  // A session with nothing to print (no squads saved) is left out rather than zipped as an empty PDF; the screen warns about it.
  for (const d of collate(kind, sessions, gymOrder, printedOn)) if (d.pages.length > 0) zip.file(d.file, pdfBytes(d.pages, d.file));
  return { name: allSessionsFileName(kind, 'zip'), bytes: await zip.generateAsync({ type: 'blob' }) };
}
