import { Component, type ReactNode } from 'react';
import { ChromeStyles } from './chrome';
import { useMessages, useTheme } from './GridProvider';

interface Props {
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
  /** Bumped by "Try again" so the children mount fresh instead of re-rendering their broken state. */
  attempt: number;
}

function Fallback({ onRetry }: { onRetry: () => void }) {
  const m = useMessages();
  const theme = useTheme();
  return (
    <div className="rdg-chrome" data-rdg-theme={theme} role="alert" style={{ padding: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
      <ChromeStyles />
      <span>{m.errorTitle}</span>
      <button type="button" className="rdg-textbtn" onClick={onRetry}>
        {m.errorRetry}
      </button>
    </div>
  );
}

/** Keeps a failure inside the grid from blanking the whole host page; the host hears about it through `onError`. */
export class GridErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <Fallback onRetry={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} />;
    }
    return <div key={this.state.attempt} style={{ display: 'contents' }}>{this.props.children}</div>;
  }
}
