import {
  type CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { DateOrder } from '../core/model/dates';
import { type SheetSnapshot, serializeSheet } from '../core/snapshot';
import { Spreadsheet } from '../core/Spreadsheet';
import { Workbook } from '../core/Workbook';
import { deserializeWorkbook, serializeWorkbook, type WorkbookSnapshot } from '../core/workbookSnapshot';
import type { GridController } from '../input/GridController';
import { DataGrid } from './DataGrid';
import { FormulaBar } from './FormulaBar';
import { GridErrorBoundary } from './GridErrorBoundary';
import { GridProvider, type ThemeSetting } from './GridProvider';
import type { Locale, Messages } from './messages';
import { SheetTabs } from './SheetTabs';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

export interface SheetChangeEvent {
  /** The sheet that is showing. */
  sheet: Spreadsheet;
  workbook: Workbook;
  /** Serializes the showing sheet as it is now. Call it only when you actually save: it walks every filled cell. */
  getSnapshot: () => SheetSnapshot;
  /** Serializes every sheet (and which one is active): what to save for a workbook. */
  getWorkbookSnapshot: () => WorkbookSnapshot;
}

export interface SheetGridHandle {
  /** The sheet that is showing: read cells, run commands, listen for changes. */
  readonly sheet: Spreadsheet;
  /** All the sheets. */
  readonly workbook: Workbook;
  /** The input/rendering controller, or null before the grid has mounted. */
  readonly controller: GridController | null;
  /** The showing sheet only. */
  getSnapshot(): SheetSnapshot;
  /** Every sheet; load it back with `defaultValue` or `load`. */
  getWorkbookSnapshot(): WorkbookSnapshot;
  /** Replaces everything (undo history included) with a workbook or single-sheet snapshot. Throws SnapshotError for anything else. */
  load(snapshot: unknown): void;
  focus(): void;
}

export interface SheetGridProps {
  /** A saved workbook (`getWorkbookSnapshot`) or single sheet (`getSnapshot`). Read once, when the component mounts; use `load` later. */
  defaultValue?: unknown;
  /** Size of a new sheet when there is no `defaultValue`. */
  rowCount?: number;
  colCount?: number;
  /** Blocks every change to cells, formatting and structure; viewing options (sort, filter, zoom, freeze) still work. */
  readOnly?: boolean;
  /** How an ambiguous typed date such as 3/4/2026 reads: `'dmy'` (3 April, default) or `'mdy'` (March 4). */
  dateOrder?: DateOrder;
  locale?: Locale;
  /** Overrides single UI strings of the chosen locale. */
  messages?: Partial<Messages>;
  theme?: ThemeSetting;
  /** Show the toolbar, the formula bar and the status bar. All on by default. */
  toolbar?: boolean;
  formulaBar?: boolean;
  statusBar?: boolean;
  /** Show the sheet tabs (add, rename, duplicate, delete, reorder). On by default; a workbook of one sheet still shows its tab. */
  sheetTabs?: boolean;
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

function create(props: Pick<SheetGridProps, 'defaultValue' | 'rowCount' | 'colCount'>): { workbook: Workbook; error: Error | null } {
  const blank = (): Workbook => new Workbook(new Spreadsheet({ rowCount: props.rowCount, colCount: props.colCount }));
  if (props.defaultValue !== undefined) {
    try {
      return { workbook: deserializeWorkbook(props.defaultValue), error: null };
    } catch (e) {
      // A bad save must not leave the user with nothing on screen: start blank and report it.
      return { workbook: blank(), error: e instanceof Error ? e : new Error(String(e)) };
    }
  }
  return { workbook: blank(), error: null };
}

/**
 * The batteries-included spreadsheet: toolbar, formula bar, grid and status bar in one component.
 * For a different layout, compose `DataGrid`, `Toolbar`, `FormulaBar` and `StatusBar` yourself around a `Spreadsheet`.
 */
export const SheetGrid = forwardRef<SheetGridHandle, SheetGridProps>(function SheetGrid(props, ref) {
  const {
    readOnly = false,
    dateOrder = 'dmy',
    locale,
    messages,
    theme,
    toolbar = true,
    formulaBar = true,
    statusBar = true,
    sheetTabs = true,
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
  const [workbook, setWorkbook] = useState(initial.workbook);
  // The sheet that shows is whichever the workbook says is active (its tabs change it).
  const sheet = useSyncExternalStore(
    (listener) => workbook.subscribe(listener),
    () => workbook.active,
    () => workbook.active,
  );
  const [controller, setController] = useState<GridController | null>(null);
  // Each sheet has its own grid surface; the zoom the user chose carries over when they switch sheets.
  const [liveZoom, setLiveZoom] = useState<number | undefined>(undefined);
  const handlers = useRef({ onChange, onError });
  handlers.current = { onChange, onError };

  useEffect(() => {
    if (initial.error !== null) handlers.current.onError?.(initial.error);
  }, [initial]);

  // Before paint, so a read-only sheet is never editable even for a frame.
  useLayoutEffect(() => {
    workbook.readOnly = readOnly;
  }, [workbook, readOnly]);

  useLayoutEffect(() => {
    workbook.dateOrder = dateOrder;
  }, [workbook, dateOrder]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = (): void => {
      timer = undefined;
      const current = workbook.active;
      handlers.current.onChange?.({
        sheet: current,
        workbook,
        getSnapshot: () => serializeSheet(current),
        getWorkbookSnapshot: () => serializeWorkbook(workbook),
      });
    };
    const trigger = (): void => {
      // Sorting, filtering or resizing a read-only sheet changes how it is viewed, not the document: nothing to save.
      if (workbook.readOnly) return;
      clearTimeout(timer);
      timer = setTimeout(fire, changeDelay);
    };
    // Every sheet reports its own changes; sheets come and go, so the subscriptions follow the list.
    const subscriptions = new Map<Spreadsheet, () => void>();
    const follow = (): void => {
      for (const s of workbook.sheets) if (!subscriptions.has(s)) subscriptions.set(s, s.subscribeChanges(trigger));
      for (const [s, off] of subscriptions) {
        if (workbook.sheets.includes(s)) continue;
        off();
        subscriptions.delete(s);
      }
    };
    follow();
    const offWorkbook = workbook.subscribe(() => {
      follow();
      trigger();
    });
    return () => {
      offWorkbook();
      for (const off of subscriptions.values()) off();
      if (timer !== undefined) {
        clearTimeout(timer);
        fire(); // never lose the last edit because the component went away
      }
    };
  }, [workbook, changeDelay]);

  const focus = useCallback(() => controller?.editor.focus(), [controller]);

  useImperativeHandle(
    ref,
    () => ({
      sheet,
      workbook,
      controller,
      getSnapshot: () => serializeSheet(sheet),
      getWorkbookSnapshot: () => serializeWorkbook(workbook),
      load: (snapshot: unknown) => setWorkbook(deserializeWorkbook(snapshot)),
      focus,
    }),
    [sheet, workbook, controller, focus],
  );

  return (
    <GridProvider locale={locale} messages={messages} theme={theme}>
      <div className={className} style={{ ...ROOT, ...style }}>
        <GridErrorBoundary onError={(e) => handlers.current.onError?.(e)}>
          {toolbar && <Toolbar sheet={sheet} grid={controller} onAction={focus} onImportWorkbook={setWorkbook} />}
          {formulaBar && <FormulaBar sheet={sheet} grid={controller} />}
          <div style={{ flex: 1, minHeight: 0 }}>
            <DataGrid
              sheet={sheet}
              frozenRows={frozenRows}
              frozenCols={frozenCols}
              zoom={zoom ?? liveZoom}
              onZoomChange={(z) => {
                setLiveZoom(z);
                onZoomChange?.(z);
              }}
              onReady={setController}
            />
          </div>
          {sheetTabs && <SheetTabs workbook={workbook} onAction={focus} />}
          {statusBar && <StatusBar sheet={sheet} />}
        </GridErrorBoundary>
      </div>
    </GridProvider>
  );
});
