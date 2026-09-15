import { Component, type ReactNode } from 'react';
import { Button, Panel } from './kit';

/**
 * The one thing `Suspense` never does: catch a render error. Every screen up to EVOLUTION 6.0 assumed
 * none would ever throw during render, so nothing here caught one - a single bad selector (or a future
 * one) unmounted the whole app to a blank page instead of just the screen that broke. This boundary is
 * the backstop: a screen that throws shows a recoverable panel, the sidebar and every other screen stay
 * usable, and reloading only resets the one screen that failed, not the whole session.
 */
interface State {
  error: Error | null;
}

export class ScreenErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <Panel title="this screen failed to render">
        <p className="text-sm leading-relaxed text-objection">{error.message}</p>
        <p className="mt-3 text-2xs leading-relaxed text-fg-mute">
          The rest of RISK//SWARM is unaffected — use the sidebar to go anywhere else. Retrying reloads
          only this screen.
        </p>
        <Button className="mt-4" onClick={this.reset}>retry this screen</Button>
      </Panel>
    );
  }
}
