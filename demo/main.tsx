import { createRoot } from 'react-dom/client';
import { VERSION } from '../src/index';

createRoot(document.getElementById('root')!).render(<div data-testid="demo">Grid demo v{VERSION}</div>);
