import { DEFAULT_BORDER } from '../core/model/borders';
import type { Spreadsheet } from '../core/Spreadsheet';
import type { GridController } from '../input/GridController';
import type { MenuEntry } from './Menu';
import type { Messages } from './messages';
import { borderEntries, deleteEntries, freezeEntries, functionEntries, insertEntries, numberFormatEntries, valignEntries, visibilityEntries, wrapEntries, zoomEntries } from './toolbarMenus';

/** One thing the user can do, as the command search lists it. */
export interface Command {
  /** Stable across languages and across the selection (so "recently used" survives both). */
  id: string;
  label: string;
  /** The toolbar group or menu it lives under; searched too ("border" finds Borders: All). */
  group: string;
  shortcut?: string;
  disabled: boolean;
  checked?: boolean;
  run: () => void;
}

export interface CommandContext {
  sheet: Spreadsheet;
  grid: GridController | null;
  m: Messages;
  /** The File menu's entries, which need the toolbar's file inputs and so are built there. */
  fileEntries: MenuEntry[];
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Menu entries (skipping separators) as commands, ids by position: labels carry counts and change with the selection. */
function fromEntries(section: string, group: string, entries: readonly MenuEntry[], mutating: boolean, readOnly: boolean): Command[] {
  const out: Command[] = [];
  entries.forEach((entry, index) => {
    if (entry === 'separator') return;
    out.push({
      id: `${section}:${index}`,
      label: entry.label,
      group,
      shortcut: entry.shortcut,
      disabled: entry.disabled === true || (mutating && readOnly),
      checked: entry.checked,
      run: entry.run,
    });
  });
  return out;
}

/**
 * Everything the toolbar and its menus can do, as one flat list for the command search. It reuses the menus' own entry
 * builders, so a command can never behave differently from its button.
 */
export function buildCommands({ sheet, grid, m, fileEntries }: CommandContext): Command[] {
  const { activeRow, activeCol } = sheet.selection;
  const style = sheet.styles.get(sheet.getCellByView(activeRow, activeCol).styleId);
  const readOnly = sheet.readOnly;
  const noGrid = grid === null;
  const cmd = (id: string, label: string, group: string, run: () => void, extra: Partial<Command> = {}, mutating = true): Command => ({
    id,
    label,
    group,
    run,
    disabled: (mutating && readOnly) || extra.disabled === true,
    shortcut: extra.shortcut,
    checked: extra.checked,
  });
  const merged = sheet.hasMergeInSelection();
  const list: Command[] = [
    cmd('undo', m.undo, m.groupHistory, () => void sheet.undo(), { shortcut: `${MOD}Z`, disabled: !sheet.history.canUndo }),
    cmd('redo', m.redo, m.groupHistory, () => void sheet.redo(), { shortcut: `${MOD}Y`, disabled: !sheet.history.canRedo }),
    cmd('paintFormat', m.paintFormat, m.groupHistory, () => grid?.painter.toggle(), { disabled: noGrid }),
    cmd('clearFormat', m.clearFormatting, m.groupHistory, () => sheet.clearFormatting(), { shortcut: `${MOD}\\` }),
    cmd('cut', m.cut, m.groupClipboard, () => grid?.clipboard.exec('cut'), { shortcut: `${MOD}X`, disabled: noGrid }),
    cmd('copy', m.copy, m.groupClipboard, () => grid?.clipboard.exec('copy'), { shortcut: `${MOD}C`, disabled: noGrid }, false),
    ...(grid === null
      ? []
      : [
          cmd('paste', m.paste, m.groupClipboard, () => void grid.clipboard.pasteFromSystem(), { shortcut: `${MOD}V` }),
          cmd('pasteValues', m.pasteValues, m.groupClipboard, () => grid.clipboard.armPaste('values')),
          cmd('pasteFormat', m.pasteFormat, m.groupClipboard, () => grid.clipboard.armPaste('format')),
        ]),
    cmd('find', m.findAndReplace, m.file, () => grid?.onOpenFind?.(false), { shortcut: `${MOD}F`, disabled: noGrid }, false),
    cmd('replace', m.replace, m.file, () => grid?.onOpenFind?.(true), { disabled: noGrid }, false),
    cmd('sortAsc', m.sortAsc, m.groupSort, () => sheet.sortByColumn(activeCol, true), {}, false),
    cmd('sortDesc', m.sortDesc, m.groupSort, () => sheet.sortByColumn(activeCol, false), {}, false),
    cmd('filter', m.filter, m.groupSort, () => grid?.onOpenFilter?.(activeCol, 120, 140), { disabled: noGrid, checked: sheet.isColumnFiltered(activeCol) }, false),
    cmd('removeFilters', m.removeSortAndFilters, m.groupSort, () => {
      sheet.clearSort();
      sheet.clearFilters();
    }, { disabled: sheet.viewState.sort === null && sheet.viewState.filters.size === 0 }, false),
    cmd('conditional', m.conditionalFormatting, m.groupSort, () => grid?.onOpenConditional?.(), { disabled: noGrid }),
    cmd('validation', m.dataValidation, m.groupSort, () => grid?.onOpenValidation?.(), { disabled: noGrid }),
    cmd('currency', m.formatCurrencyButton, m.groupNumber, () => sheet.formatSelection({ numberFormat: '$#,##0.00' }, 'Number format'), { shortcut: `${MOD}⇧4` }),
    cmd('percent', m.formatPercentButton, m.groupNumber, () => sheet.formatSelection({ numberFormat: '0.00%' }, 'Number format'), { shortcut: `${MOD}⇧5` }),
    cmd('decimalsLess', m.decreaseDecimals, m.groupNumber, () => sheet.shiftSelectionDecimals(-1)),
    cmd('decimalsMore', m.increaseDecimals, m.groupNumber, () => sheet.shiftSelectionDecimals(1)),
    cmd('fontSmaller', m.decreaseFontSize, m.groupFont, () => sheet.stepSelectionFontSize(-1), { shortcut: `${MOD}⇧,` }),
    cmd('fontLarger', m.increaseFontSize, m.groupFont, () => sheet.stepSelectionFontSize(1), { shortcut: `${MOD}⇧.` }),
    cmd('bold', m.bold, m.groupTextStyle, () => sheet.toggleStyle('bold'), { shortcut: `${MOD}B`, checked: style.bold === true }),
    cmd('italic', m.italic, m.groupTextStyle, () => sheet.toggleStyle('italic'), { shortcut: `${MOD}I`, checked: style.italic === true }),
    cmd('underline', m.underline, m.groupTextStyle, () => sheet.toggleStyle('underline'), { shortcut: `${MOD}U`, checked: style.underline === true }),
    cmd('strike', m.strike, m.groupTextStyle, () => sheet.toggleStyle('strike'), { shortcut: `${MOD}⇧X`, checked: style.strike === true }),
    cmd(
      'merge',
      merged ? m.unmergeCells : m.mergeCells,
      m.groupTextStyle,
      () => void (merged ? sheet.unmergeSelection() : sheet.mergeSelection()),
      { disabled: !merged && !sheet.canMerge(), checked: merged },
    ),
    cmd('alignLeft', m.alignLeft, m.groupAlignment, () => sheet.formatSelection({ align: 'left' }, 'Align'), { shortcut: `${MOD}⇧L`, checked: style.align === 'left' }),
    cmd('alignCenter', m.alignCenter, m.groupAlignment, () => sheet.formatSelection({ align: 'center' }, 'Align'), { shortcut: `${MOD}⇧E`, checked: style.align === 'center' }),
    cmd('alignRight', m.alignRight, m.groupAlignment, () => sheet.formatSelection({ align: 'right' }, 'Align'), { shortcut: `${MOD}⇧R`, checked: style.align === 'right' }),
  ];
  return [
    ...list,
    ...fromEntries('numberFormat', m.moreFormats, numberFormatEntries(sheet, m), true, readOnly),
    ...fromEntries('borders', m.borders, borderEntries(sheet, m, DEFAULT_BORDER, () => {}), true, readOnly),
    ...fromEntries('wrap', m.textWrapping, wrapEntries(sheet, m), true, readOnly),
    ...fromEntries('valign', m.verticalAlign, valignEntries(sheet, m), true, readOnly),
    ...fromEntries('insert', m.insert, insertEntries(sheet, m), true, readOnly),
    ...fromEntries('delete', m.delete, deleteEntries(sheet, m), true, readOnly),
    ...fromEntries('visibility', m.visibility, visibilityEntries(sheet, m), false, readOnly),
    ...fromEntries('freeze', m.freeze, freezeEntries(sheet, m), false, readOnly),
    ...fromEntries('functions', m.functions, functionEntries(sheet, m), true, readOnly),
    ...(grid === null ? [] : fromEntries('zoom', m.zoom, zoomEntries(grid), false, readOnly)),
    ...fromEntries('file', m.file, fileEntries, false, readOnly),
  ];
}

/** Lower case without accents (and đ as d), so "dinh dang" finds "Định dạng". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/**
 * The commands that match `query`, best first. Every word of the query must appear in the command's name or group.
 * Names that start with the query come first, then names with a word starting with it, then the rest; within a rank the
 * recently used commands (`recent`, most recent first) come first. Disabled commands are listed last. An empty query
 * lists the recent commands, then everything in toolbar order.
 */
export function matchCommands(commands: readonly Command[], query: string, recent: readonly string[] = []): Command[] {
  const words = fold(query).split(/\s+/).filter((w) => w !== '');
  const recency = (c: Command): number => {
    const at = recent.indexOf(c.id);
    return at < 0 ? recent.length : at;
  };
  const scored: Array<{ command: Command; rank: number; index: number }> = [];
  commands.forEach((command, index) => {
    const label = fold(command.label);
    const haystack = `${label} ${fold(command.group)}`;
    if (!words.every((w) => haystack.includes(w))) return;
    let rank = 3;
    if (words.length === 0) rank = 0;
    else if (label.startsWith(words[0] as string)) rank = 0;
    else if (words.every((w) => label.split(/[\s:(),]+/).some((token) => token.startsWith(w)))) rank = 1;
    else if (words.every((w) => label.includes(w))) rank = 2;
    scored.push({ command, rank, index });
  });
  scored.sort(
    (a, b) =>
      Number(a.command.disabled) - Number(b.command.disabled) ||
      a.rank - b.rank ||
      recency(a.command) - recency(b.command) ||
      a.index - b.index,
  );
  return scored.map((s) => s.command);
}

/** The new "recent" list after running `id`: it goes first, no duplicates, at most `limit` kept. */
export function rememberCommand(recent: readonly string[], id: string, limit = 8): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, limit);
}
