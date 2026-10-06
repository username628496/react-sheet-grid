import {
  type CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { deserializeSheet, serializeSheet, type SheetSnapshot } from '../core/snapshot';
import { Spreadsheet } from '../core/Spreadsheet';
import type { GridController } from '../input/GridController';
import { DataGrid } from './DataGrid';
import { FormulaBar } from './FormulaBar';
import { GridErrorBoundary } from './GridErrorBoundary';
import { GridProvider, type ThemeSetting } from './GridProvider';
import type { Locale, Messages } from './messages';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

export interface SheetChangeEvent {
  sheet: Spreadsheet;
  /** Serializes the sheet as it is now. Call it only when you actually save: it walks every filled cell. */
  getSnapshot: () => SheetSnapshot;
}

export interface SheetGridHandle {
  /** The headless sheet behind the component: read cells, run commands, listen for changes. */
  readonly sheet: Spreadsheet;
  /** The input/rendering controller, or null before the grid has mounted. */
  readonly controller: GridController | null;
  getSnapshot(): SheetSnapshot;
  /** Replaces the whole sheet (undo history included). Throws SnapshotError for data that is not a snapshot. */
  load(snapshot: unknown): void;
  focus(): void;
}

export interface SheetGridProps {
  /** A saved sheet (from `getSnapshot`/`serializeSheet`). Read once, when the component mounts; use `load` later. */
  defaultValue?: unknown;
  /** Size of a new sheet when there is no `defaultValue`. */
  rowCount?: number;
  colCount?: number;
  /** Blocks every change to cells, formatting and structure; viewing options (sort, filter, zoom, freeze) still work. */
  readOnly?: boolean;
  locale?: Locale;
  /** Overrides single UI strings of the chosen locale. */
  messages?: Partial<Messages>;
  theme?: ThemeSetting;
  /** Show the toolbar, the formula bar and the status bar. All on by default. */
  toolbar?: boolean;
  formulaBar?: boolean;
  statusBar?: boolean;
  /** Initial frozen panes. */
  frozenRows?: number;
  frozenCols?: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /**
   * Called after the document changed (an edit, paste, format, undo, freeze…), never for selection or scroll, and
   * never while `readOnly` is on.
   * Calls are batched: it fires once, `changeDelay` ms after the last change, and once more when the component unmounts
   * with changes still pending.
   */
  onChange?: (event: SheetChangeEvent) => void;
  /** Milliseconds to wait after the last change before `onChange`. Default 300. */
  changeDelay?: number;
  /** Called when `defaultValue` cannot be read (the grid then starts blank) and when rendering fails (a fallback with a retry button is shown). */
  onError?: (error: Error) => void;
  className?: string;
  /** Applied to the outer box, which is a flex column filling its parent (height: 100%) unless overridden. */
  style?: CSSProperties;
}

const ROOT: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 };

function create(props: Pick<SheetGridProps, 'defaultValue' | 'rowCount' | 'colCount'>): { sheet: Spreadsheet; error: Error | null } {
  if (props.defaultValue !== undefined) {
    try {
      return { sheet: deserializeSheet(props.defaultValue), error: null };
    } catch (e) {
      // A bad save must not leave the user with nothing on screen: start blank and report it.
      return { sheet: new Spreadsheet({ rowCount: props.rowCount, colCount: props.colCount }), error: e instanceof Error ? e : new Error(String(e)) };
    }
  }
  return { sheet: new Spreadsheet({ rowCount: props.rowCount, colCount: props.colCount }), error: null };
}

/**
 * The batteries-included spreadsheet: toolbar, formula bar, grid and status bar in one component.
 * For a different layout, compose `DataGrid`, `Toolbar`, `FormulaBar` and `StatusBar` yourself around a `Spreadsheet`.
 */
export const SheetGrid = forwardRef<SheetGridHandle, SheetGridProps>(function SheetGrid(props, ref) {
  const {
    readOnly = false,
    locale,
    messages,
    theme,
    toolbar = true,
    formulaBar = true,
    statusBar = true,
    frozenRows,
    frozenCols,
    zoom,
    onZoomChange,
    onChange,
    changeDelay = 300,
    onError,
    className,
    style,
  } = props;
  const [initial] = useState(() => create(props));
  const [sheet, setSheet] = useState(initial.sheet);
  const [controller, setController] = useState<GridController | null>(null);
  const handlers = useRef({ onChange, onError });
  handlers.current = { onChange, onError };

  useEffect(() => {
    if (initial.error !== null) handlers.current.onError?.(initial.error);
  }, [initial]);

  // Before paint, so a read-only sheet is never editable even for a frame.
  useLayoutEffect(() => {
    sheet.readOnly = readOnly;
  }, [sheet, readOnly]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = (): void => {
      timer = undefined;
      handlers.current.onChange?.({ sheet, getSnapshot: () => serializeSheet(sheet) });
    };
    const off = sheet.subscribeChanges(() => {
      // Sorting, filtering or resizing a read-only sheet changes how it is viewed, not the document: nothing to save.
      if (sheet.readOnly) return;
      clearTimeout(timer);
      timer = setTimeout(fire, changeDelay);
    });
    return () => {
      off();
      if (timer !== undefined) {
        clearTimeout(timer);
        fire(); // never lose the last edit because the component went away
      }
    };
  }, [sheet, changeDelay]);

  const focus = useCallback(() => controller?.editor.focus(), [controller]);

  useImperativeHandle(
    ref,
    () => ({
      sheet,
      controller,
      getSnapshot: () => serializeSheet(sheet),
      load: (snapshot: unknown) => setSheet(deserializeSheet(snapshot)),
      focus,
    }),
    [sheet, controller, focus],
  );

  return (
    <GridProvider locale={locale} messages={messages} theme={theme}>
      <div className={className} style={{ ...ROOT, ...style }}>
        <GridErrorBoundary onError={(e) => handlers.current.onError?.(e)}>
          {toolbar && <Toolbar sheet={sheet} grid={controller} onAction={focus} />}
          {formulaBar && <FormulaBar sheet={sheet} grid={controller} />}
          <div style={{ flex: 1, minHeight: 0 }}>
            <DataGrid
              sheet={sheet}
              frozenRows={frozenRows}
              frozenCols={frozenCols}
              zoom={zoom}
              onZoomChange={onZoomChange}
              onReady={setController}
            />
          </div>
          {statusBar && <StatusBar sheet={sheet} />}
        </GridErrorBoundary>
      </div>
    </GridProvider>
  );
});
