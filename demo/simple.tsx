import { createRoot } from 'react-dom/client';
import { SheetGrid, type SheetGridHandle, type SheetSnapshot } from '../src/index';

// The smallest possible use of the library, and the page the e2e tests drive for the host-facing API:
// ?readonly=1 shows a read-only sheet, ?value=<json> starts from a saved sheet.
declare global {
  interface Window {
    __crash?: boolean;
    __mount?: () => void;
    __unmount?: () => void;
    __handle?: SheetGridHandle | null;
    __handles?: Array<SheetGridHandle | null>;
    __changes?: SheetSnapshot[];
    __errors?: string[];
  }
}

const params = new URLSearchParams(location.search);
const raw = params.get('value');
window.__changes = [];
window.__errors = [];

function Grid({ index }: { index: number }) {
  return (
    <SheetGrid
      ref={(handle) => {
        if (index === 0) window.__handle = handle;
        window.__handles ??= [];
        window.__handles[index] = handle;
      }}
      rowCount={50}
      colCount={26}
      defaultValue={raw === null ? undefined : (JSON.parse(raw) as unknown)}
      readOnly={params.get('readonly') === '1'}
      // Lets a test make rendering fail on demand: this string is built while the toolbar renders.
      messages={{
        resetColor: (what) => {
          if (window.__crash === true) throw new Error('boom');
          return `Reset ${what.toLowerCase()}`;
        },
      }}
      changeDelay={50}
      onChange={({ getSnapshot }) => window.__changes?.push(getSnapshot())}
      onError={(e) => window.__errors?.push(e.message)}
    />
  );
}

// ?count=2 puts two independent grids on the page (to check they do not interfere).
const count = Math.max(1, Math.min(4, Number(params.get('count') ?? 1)));

function App() {
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: `auto repeat(${count}, 1fr) auto` }}>
      <button type="button" id="before-grid">Before</button>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ minHeight: 0 }} data-testid={`sheet-${i}`}>
          <Grid index={i} />
        </div>
      ))}
      <button type="button" id="after-grid">After</button>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
window.__mount = () => root.render(<App />);
window.__unmount = () => root.render(null);
window.__mount();
