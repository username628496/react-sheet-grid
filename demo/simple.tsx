import { createRoot } from 'react-dom/client';
import { SheetGrid, type SheetGridHandle, type SheetSnapshot } from '../src/index';

// The smallest possible use of the library, and the page the e2e tests drive for the host-facing API:
// ?readonly=1 shows a read-only sheet, ?value=<json> starts from a saved sheet.
declare global {
  interface Window {
    __handle?: SheetGridHandle | null;
    __changes?: SheetSnapshot[];
    __errors?: string[];
  }
}

const params = new URLSearchParams(location.search);
const raw = params.get('value');
window.__changes = [];
window.__errors = [];

function App() {
  return (
    <SheetGrid
      ref={(handle) => {
        window.__handle = handle;
      }}
      rowCount={50}
      colCount={26}
      defaultValue={raw === null ? undefined : (JSON.parse(raw) as unknown)}
      readOnly={params.get('readonly') === '1'}
      changeDelay={50}
      onChange={({ getSnapshot }) => window.__changes?.push(getSnapshot())}
      onError={(e) => window.__errors?.push(e.message)}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
