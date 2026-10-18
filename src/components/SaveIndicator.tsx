import type { SaveState } from '../lib/autosave';

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === 'error') {
    return (
      <div className="adm-banner err" role="alert">
        Your last change did not save: {state.message} Your changes are still on this page.{' '}
        <button type="button" className="btn small" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  let text = 'Changes save automatically';
  if (state.kind === 'saving') text = 'Saving…';
  if (state.kind === 'saved') text = `Saved · ${timeFmt.format(state.at)}`;
  return <p className="sq-save" role="status" aria-live="polite" data-testid="squads-save">{text}</p>;
}
