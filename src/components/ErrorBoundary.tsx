import { Component, useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Injected in tests so recovery can be checked without reloading jsdom. */
  onReload?: () => void;
}

interface ErrorBoundaryState {
  error: unknown;
}

interface FailedRouteProps {
  onRetry: () => void;
  onReload: () => void;
}

/**
 * Keep the fallback's rendering code outside the boundary so an error in the
 * fallback itself cannot recursively trigger it. Reset whenever the URL path
 * changes; the library link remounts App without a full reload.
 */
function FailedRoute({ onRetry, onReload }: FailedRouteProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="error-boundary app" role="alert">
      <main
        id="main-content"
        className="page error-boundary-main"
        aria-labelledby="error-boundary-title"
        aria-describedby="error-boundary-description"
        tabIndex={-1}
      >
        <div className="empty-state">
          <h1 id="error-boundary-title" ref={headingRef} tabIndex={-1}>
            Something went wrong
          </h1>
          <p id="error-boundary-description">
            This page could not open. Your library, highlights and notes are still on this device.
          </p>
          <div className="empty-state-actions">
            <Link className="btn btn-primary" to="/" onClick={onRetry}>
              Back to Library
            </Link>
            <button className="btn btn-secondary" type="button" onClick={onReload}>
              Reload
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Last line of defence for render and lazy-chunk failures.
 *
 * Error details are deliberately never rendered or logged: messages and stacks
 * can contain a reader's book text. Recovery never clears IndexedDB, Cache
 * Storage or settings. Reload stays optional so a transient render failure can
 * be retried while all local data remains intact.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  private readonly retry = (): void => {
    // The same state value as a healthy boundary makes React retry the subtree.
    this.setState({ error: null });
  };

  private readonly reload = (): void => {
    this.props.onReload?.();
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <RouteReset onReset={this.retry}>
        <FailedRoute onRetry={this.retry} onReload={this.reload} />
      </RouteReset>
    );
  }
}

function RouteReset({ onReset, children }: { onReset: () => void; children: ReactNode }) {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      onReset();
    }
  }, [onReset, pathname]);

  return children;
}
