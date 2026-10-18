// Pure: a short name for a page (screen-reader label and jump-bar tooltips).
import type { Page } from './model';

export function pageLabel(page: Page): string {
  switch (page.kind) {
    case 'artistic-scorecard': return `${page.band.apparatus}, Squad ${page.band.squad}`;
    case 'tnt-scorecard': return `${page.title}, Squad ${page.squad}`;
    case 'synchro': return `Synchro, Flight ${page.flight}`;
    case 'artistic-rotation': case 'tnt-rotation': return 'Rotation sheet';
  }
}
