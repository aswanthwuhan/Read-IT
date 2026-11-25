import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function fallback(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.error-boundary');
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function ThrowOnRender(): never {
  throw new Error('private chapter text');
}

function AppRoutes() {
  const navigate = useNavigate();
  const [broken, setBroken] = useState(false);

  return (
    <>
      <button type="button" onClick={() => navigate('/read/private-book')}>
        Open reader
      </button>
      <button type="button" onClick={() => setBroken(true)}>
        Break page
      </button>
      <Routes>
        <Route path="/" element={<p>Healthy library</p>} />
        <Route path="/read/:bookId" element={broken ? <ThrowOnRender /> : <p>Healthy reader</p>} />
      </Routes>
    </>
  );
}

function mountWithRouter(ui: ReactNode) {
  return act(async () => {
    root.render(<MemoryRouter initialEntries={['/read/private-book']}>{ui}</MemoryRouter>);
  });
}

describe('ErrorBoundary', () => {
  it('renders an accessible recovery screen when a child throws', async () => {
    await mountWithRouter(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );

    const screen = fallback();
    expect(screen).not.toBeNull();
    expect(screen?.getAttribute('role')).toBe('alert');
    const labelledBy = screen?.querySelector('main')?.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('error-boundary-title');
    expect(container.querySelector(`#${labelledBy}`)?.textContent).toBe('Something went wrong');
    expect(screen?.querySelector('main')?.getAttribute('aria-describedby')).toBe(
      'error-boundary-description',
    );
    expect(document.activeElement?.id).toBe('error-boundary-title');
    expect(screen?.querySelector<HTMLAnchorElement>('a')?.textContent).toBe('Back to Library');
    expect(screen?.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('/');
    expect(screen?.getAttribute('role')).toBe('alert');
    expect(button('Reload')).not.toBeUndefined();
    expect(screen?.textContent).toContain('still on this device');
  });

  it('calls the reload callback without clearing reader data', async () => {
    const onReload = vi.fn();
    const clearSpy = vi.spyOn(Storage.prototype, 'clear');
    const indexedDbDelete = vi.spyOn(indexedDB, 'deleteDatabase');

    await mountWithRouter(
      <ErrorBoundary onReload={onReload}>
        <ThrowOnRender />
      </ErrorBoundary>,
    );
    await act(async () => {
      button('Reload')!.click();
    });

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(clearSpy).not.toHaveBeenCalled();
    expect(indexedDbDelete).not.toHaveBeenCalled();
    // A reload normally replaces the document; leaving the fallback visible is
    // safer than retrying the same broken subtree behind the reader's back.
    expect(fallback()).not.toBeNull();
  });

  it('retries and handles a repeated failure, then recovers after navigation', async () => {
    window.history.replaceState({}, '', '/read/private-book');
    await mountWithRouter(
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>,
    );

    await act(async () => {
      button('Break page')!.click();
    });
    expect(fallback()).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>('a')!.click();
    });
    expect(fallback()).toBeNull();
    expect(container.textContent).toContain('Healthy library');

    await act(async () => {
      button('Open reader')!.click();
    });
    expect(container.textContent).toContain('Healthy reader');
    await act(async () => {
      button('Break page')!.click();
    });
    expect(fallback()).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>('a')!.click();
    });
    expect(fallback()).toBeNull();
    expect(container.textContent).toContain('Healthy library');
  });

  it('never renders the error message or stack', async () => {
    const bookText = 'A private sentence from the current chapter';
    const stackLine = 'at SecretReaderComponent (reader.js:42:7)';
    const error = new Error(bookText);
    error.stack = `Error: ${bookText}\n${stackLine}`;

    function ThrowPrivateError(): never {
      throw error;
    }

    await mountWithRouter(
      <ErrorBoundary>
        <ThrowPrivateError />
      </ErrorBoundary>,
    );

    expect(container.innerHTML).not.toContain(bookText);
    expect(container.innerHTML).not.toContain(stackLine);
    expect(container.innerHTML).not.toContain('reader.js');
    expect(container.innerHTML).not.toContain('Error:');
    expect(container.querySelector('pre')).toBeNull();
  });
});
