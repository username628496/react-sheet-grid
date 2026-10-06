import { describe, expect, it } from 'vitest';
import { calc, e } from './helpers';

type Cells = Record<string, string | number>;
type Row = [formula: string, expected: unknown, cells?: Cells];

function table(rows: Row[]): void {
  it.each(rows)('%s', (formula, expected, cells) => {
    expect(calc(formula, cells ?? {})).toEqual(expected);
  });
}

describe('SUM', () => {
  table([
    ['=SUM(1,2,3)', 6],
    ['=SUM(A1:A3)', 3, { A1: 1, A2: 2, A3: 'x' }], // text inside a range is ignored
    ['=SUM(A1:A3)', 0, { A1: 'TRUE', A2: 'a' }], // booleans/text in ranges ignored
    ['=SUM(A1,A2)', 3, { A1: 1, A2: 2 }],
    ['=SUM(A1)', 0, { A1: 'x' }], // a single-cell reference behaves like a range
    ['=SUM("5",1)', 6], // direct numeric text is coerced
    ['=SUM(TRUE,1)', 2], // direct booleans count
    ['=SUM(A1:B2)', 10, { A1: 1, B1: 2, A2: 3, B2: 4 }],
    ['=SUM(A:A)', 6, { A1: 1, A5: 2, A100: 3 }],
    ['=SUM(2:2)', 3, { A2: 1, B2: 2 }], // whole-row reference
    ['=SUM(B2:A1)', 3, { A1: 1, B2: 2 }], // reversed corners
    ['=SUM(A1:A2)', 0],
    ['=SUM("x")', e('#VALUE!')],
    ['=SUM(1,#DIV/0!)', e('#DIV/0!')],
    ['=SUM(A1:A2)', e('#N/A'), { A1: '=#N/A', A2: 1 }],
    ['=SUM()', e('#N/A')],
  ]);
});

describe('AVERAGE', () => {
  table([
    ['=AVERAGE(1,2,3)', 2],
    ['=AVERAGE(A1:A3)', 3, { A1: 2, A2: 4, A3: 'text' }],
    ['=AVERAGE("4",2)', 3],
    ['=AVERAGE(A1:A3)', e('#DIV/0!')],
    ['=AVERAGE(A1:A2)', e('#DIV/0!'), { A1: 'a', A2: 'b' }],
    ['=AVERAGE("x")', e('#VALUE!')],
    ['=AVERAGE(1,#N/A)', e('#N/A')],
    ['=AVERAGE()', e('#N/A')],
  ]);
});

describe('COUNT', () => {
  table([
    ['=COUNT(1,2,3)', 3],
    ['=COUNT(A1:A5)', 2, { A1: 1, A2: 'x', A3: 2, A4: 'TRUE' }],
    ['=COUNT(A1:A2)', 0],
    ['=COUNT(A1:A2)', 1, { A1: '=1/0', A2: 5 }], // errors are not counted and do not propagate
    ['=COUNT(A:A)', 3, { A1: 1, A50: 2, A999: 3 }],
    ['=COUNT()', e('#N/A')],
  ]);
});

describe('MIN / MAX', () => {
  table([
    ['=MAX(1,5,3)', 5],
    ['=MIN(4,2,8)', 2],
    ['=MAX(A1:A3)', 9, { A1: 3, A2: 9, A3: 'z' }],
    ['=MIN(A1:A3)', 3, { A1: 3, A2: 9 }],
    ['=MAX(A1:A3)', 0], // nothing numeric
    ['=MIN(-1,"2")', -1],
    ['=MAX("x")', e('#VALUE!')],
    ['=MAX(1,#REF!)', e('#REF!')],
    ['=MAX(A1:A2)', e('#DIV/0!'), { A1: '=1/0', A2: 1 }],
    ['=MIN()', e('#N/A')],
  ]);
});

describe('IF', () => {
  table([
    ['=IF(TRUE,1,2)', 1],
    ['=IF(0,1,2)', 2],
    ['=IF(5,"yes","no")', 'yes'],
    ['=IF("true",1,2)', 1],
    ['=IF(FALSE,1)', false],
    ['=IF(A1,1,2)', 2], // empty cell is FALSE
    ['=IF(A1>1,"big","small")', 'big', { A1: 5 }],
    ['=IF(TRUE,1,1/0)', 1], // untaken branch is not evaluated
    ['=IF(FALSE,1/0,2)', 2],
    ['=IF(1,A1,B1)', 'x', { A1: 'x', B1: 'y' }],
    ['=IF("maybe",1,2)', e('#VALUE!')],
    ['=IF(#N/A,1,2)', e('#N/A')],
    ['=IF(TRUE,1/0,2)', e('#DIV/0!')],
    ['=IF(1)', e('#N/A')],
    ['=IF(1,2,3,4)', e('#N/A')],
    ['=IF(A1:A2,1,2)', e('#VALUE!'), { A1: 1, A2: 2 }],
  ]);
});

describe('ROUND', () => {
  table([
    ['=ROUND(2.5)', 3],
    ['=ROUND(-2.5)', -3],
    ['=ROUND(0.5)', 1],
    ['=ROUND(1.005,2)', 1.01],
    ['=ROUND(2.345,2)', 2.35],
    ['=ROUND(3.14159,3)', 3.142],
    ['=ROUND(1234.567,-2)', 1200],
    ['=ROUND(1250,-2)', 1300],
    ['=ROUND(2.5,0.9)', 3], // places are truncated
    ['=ROUND("3.7")', 4],
    ['=ROUND(TRUE)', 1],
    ['=ROUND(A1,1)', 1.2, { A1: 1.234 }],
    ['=ROUND(1e-7,3)', 0],
    ['=ROUND("x")', e('#VALUE!')],
    ['=ROUND(1,"y")', e('#VALUE!')],
    ['=ROUND(#N/A)', e('#N/A')],
    ['=ROUND()', e('#N/A')],
    ['=ROUND(1,2,3)', e('#N/A')],
  ]);
});

describe('CONCAT', () => {
  table([
    ['=CONCAT("a","b")', 'ab'],
    ['=CONCAT(1,2)', '12'],
    ['=CONCAT(TRUE,"x")', 'TRUEx'],
    ['=CONCAT(A1,"x")', 'x'],
    ['=CONCAT(A1,A2)', 'ab', { A1: 'a', A2: 'b' }],
    ['=CONCAT("a")', e('#N/A')],
    ['=CONCAT("a","b","c")', e('#N/A')],
    ['=CONCAT(#N/A,"x")', e('#N/A')],
    ['=CONCAT("x",#REF!)', e('#REF!')],
    ['=CONCAT(A1:A2,"x")', e('#VALUE!'), { A1: 'a', A2: 'b' }],
  ]);
});

const NUMS: Cells = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, B1: 10, B2: 20, B3: 30, B4: 40, B5: 50 };
const FRUIT: Cells = { A1: 'apple', A2: 'Banana', A3: 'APPLE', A4: 'cherry', A5: 'avocado', B1: 1, B2: 2, B3: 3, B4: 4, B5: 5 };

describe('SUMIF', () => {
  table([
    ['=SUMIF(A1:A5,">2")', 12, NUMS],
    ['=SUMIF(A1:A5,">2",B1:B5)', 120, NUMS],
    ['=SUMIF(A1:A5,3,B1:B5)', 30, NUMS],
    ['=SUMIF(A1:A5,"=3",B1:B5)', 30, NUMS],
    ['=SUMIF(A1:A5,"<>3",B1:B5)', 120, NUMS],
    ['=SUMIF(A1:A5,"<=2",B1:B5)', 30, NUMS],
    ['=SUMIF(A1:A5,">=4")', 9, NUMS],
    ['=SUMIF(A1:A5,">100")', 0, NUMS],
    ['=SUMIF(A1:A5,">2",B2:B6)', 90, NUMS], // sum range is aligned by offset
    ['=SUMIF(A1:A5,"apple",B1:B5)', 4, FRUIT], // case-insensitive
    ['=SUMIF(A1:A5,"a*",B1:B5)', 9, FRUIT], // wildcard: apple, APPLE, avocado
    ['=SUMIF(A1:A5,"?????",B1:B5)', 4, FRUIT], // 5 letters: apple, APPLE
    ['=SUMIF(A1:A5,"<>apple",B1:B5)', 11, FRUIT],
    ['=SUMIF(A1:A5,">b",B1:B5)', 6, FRUIT], // text comparison: Banana?, cherry
    ['=SUMIF(A1:A5,A2,B1:B5)', 2, FRUIT], // criterion from a cell
    ['=SUMIF(A:A,">2")', 12, NUMS],
    ['=SUMIF(1,">2")', e('#VALUE!')],
    ['=SUMIF(A1:A5,">2",5)', e('#VALUE!'), NUMS],
    ['=SUMIF(A1:A5,#N/A)', e('#N/A'), NUMS],
    ['=SUMIF(A1:A5,">0",B1:B5)', e('#DIV/0!'), { ...NUMS, B3: '=1/0' }],
    ['=SUMIF(A1:A5)', e('#N/A'), NUMS],
  ]);
});

describe('COUNTIF', () => {
  table([
    ['=COUNTIF(A1:A5,">=3")', 3, NUMS],
    ['=COUNTIF(A1:A5,3)', 1, NUMS],
    ['=COUNTIF(A1:A5,"<>3")', 4, NUMS],
    ['=COUNTIF(A1:A5,"apple")', 2, FRUIT],
    ['=COUNTIF(A1:A5,"*an*")', 1, FRUIT],
    ['=COUNTIF(A1:A5,"a*")', 3, FRUIT],
    ['=COUNTIF(A1:A5,"<>apple")', 3, FRUIT],
    ['=COUNTIF(A1:A5,"c*")', 1, FRUIT],
    ['=COUNTIF(A1:A5,"~*")', 0, FRUIT],
    ['=COUNTIF(A1:A5,"")', 2, { A1: 1, A3: 2, A5: 3 }], // two blank cells
    ['=COUNTIF(A1:A5,"=")', 2, { A1: 1, A3: 2, A5: 3 }],
    ['=COUNTIF(A1:A5,"<>")', 3, { A1: 1, A3: 2, A5: 3 }],
    ['=COUNTIF(A:A,">0")', 3, { A1: 1, A500: 2, A900: 3 }],
    ['=COUNTIF(A1:A5,TRUE)', 1, { A1: '=TRUE', A2: 1 }],
    ['=COUNTIF(A1:A5,5)', 0],
    ['=COUNTIF(5,5)', e('#VALUE!')],
    ['=COUNTIF(A1:A5)', e('#N/A')],
    ['=COUNTIF(A1:A5,#REF!)', e('#REF!')],
  ]);

  it('counts a blank-matching criterion across a huge unstored area without scanning it', () => {
    expect(calc('=COUNTIF(A:A,"")', { A1: 1 })).toBe(1_048_576 - 1);
  });
});

const TABLE: Cells = {
  A1: 1, B1: 'one', C1: 100,
  A2: 2, B2: 'two', C2: 200,
  A3: 4, B3: 'four', C3: 400,
  A4: 8, B4: 'Eight', C4: 800,
};

describe('VLOOKUP', () => {
  table([
    ['=VLOOKUP(2,A1:C4,2,FALSE)', 'two', TABLE],
    ['=VLOOKUP(2,A1:C4,3,FALSE)', 200, TABLE],
    ['=VLOOKUP(2,A1:C4,1,FALSE)', 2, TABLE],
    ['=VLOOKUP(3,A1:C4,2,FALSE)', e('#N/A'), TABLE],
    ['=VLOOKUP(3,A1:C4,2)', 'two', TABLE], // approximate: largest key <= 3
    ['=VLOOKUP(3,A1:C4,2,TRUE)', 'two', TABLE],
    ['=VLOOKUP(100,A1:C4,3)', 800, TABLE],
    ['=VLOOKUP(0,A1:C4,2)', e('#N/A'), TABLE], // smaller than every key
    ['=VLOOKUP(1,A1:C4,2)', 'one', TABLE],
    ['=VLOOKUP("eight",B1:C4,2,FALSE)', 800, TABLE], // case-insensitive
    ['=VLOOKUP("t*",B1:C4,2,FALSE)', 200, TABLE], // wildcard, first match
    ['=VLOOKUP("fo?r",B1:C4,2,FALSE)', 400, TABLE],
    ['=VLOOKUP(2,A:C,2,FALSE)', 'two', TABLE], // whole-column range
    ['=VLOOKUP(A1,A1:C4,3,FALSE)', 100, TABLE],
    ['=VLOOKUP(2,A1:C4,0,FALSE)', e('#VALUE!'), TABLE],
    ['=VLOOKUP(2,A1:C4,4,FALSE)', e('#REF!'), TABLE],
    ['=VLOOKUP(2,A1:C4,"x",FALSE)', e('#VALUE!'), TABLE],
    ['=VLOOKUP(2,A1:C4,2,"maybe")', e('#VALUE!'), TABLE],
    ['=VLOOKUP(#N/A,A1:C4,2,FALSE)', e('#N/A'), TABLE],
    ['=VLOOKUP(2,5,2,FALSE)', e('#VALUE!'), TABLE],
    ['=VLOOKUP(2,A1:C4,2,FALSE)', e('#N/A')], // empty sheet
    ['=VLOOKUP("two",A1:C4,2,FALSE)', e('#N/A'), TABLE], // text key vs number column
    ['=VLOOKUP(2,A1:C4)', e('#N/A'), TABLE],
  ]);
});

describe('AND / OR / NOT', () => {
  table([
    ['=AND(TRUE,TRUE)', true],
    ['=AND(TRUE,FALSE)', false],
    ['=AND(1,2)', true],
    ['=AND(A1:A3)', false, { A1: 'TRUE', A2: 'FALSE', A3: 'TRUE' }],
    ['=AND(A1:A2)', e('#VALUE!'), { A1: 'x', A2: 'y' }], // text in ranges is ignored, nothing left
    ['=AND("x")', e('#VALUE!')],
    ['=OR(FALSE,FALSE)', false],
    ['=OR(FALSE,1)', true],
    ['=OR(A1:A2)', true, { A1: 0, A2: 3 }],
    ['=OR(#N/A,TRUE)', e('#N/A')],
    ['=NOT(TRUE)', false],
    ['=NOT(0)', true],
    ['=NOT("x")', e('#VALUE!')],
  ]);
});

describe('IFERROR', () => {
  table([
    ['=IFERROR(1/0,"bad")', 'bad'],
    ['=IFERROR(5,"bad")', 5],
    ['=IFERROR(1/0)', ''],
    ['=IFERROR(A1,0)', 0, { A1: '=#N/A' }],
    ['=IFERROR(1,1/0)', 1], // the fallback is never evaluated
    ['=IFERROR(1/0,1/0)', e('#DIV/0!')],
  ]);
});

describe('number helpers', () => {
  table([
    ['=ABS(-3)', 3],
    ['=ABS("x")', e('#VALUE!')],
    ['=INT(-1.5)', -2],
    ['=INT(2.9)', 2],
    ['=SQRT(9)', 3],
    ['=SQRT(-1)', e('#NUM!')],
    ['=MOD(7,3)', 1],
    ['=MOD(-3,2)', 1],
    ['=MOD(3,-2)', -1],
    ['=MOD(1,0)', e('#DIV/0!')],
    ['=POWER(2,10)', 1024],
    ['=POWER(0,-1)', e('#DIV/0!')],
    ['=POWER(-8,0.5)', e('#NUM!')],
    ['=COUNTA(A1:A4)', 2, { A1: 'x', A3: 5 }],
    ['=COUNTA(1,"a",A1)', 3, { A1: 'x' }],
  ]);
});

describe('text helpers', () => {
  table([
    ['=LEN("hello")', 5],
    ['=LEN(123)', 3],
    ['=LEN("")', 0],
    ['=UPPER("aBc")', 'ABC'],
    ['=LOWER("aBc")', 'abc'],
    ['=TRIM("  a   b  ")', 'a b'],
    ['=LEFT("hello",2)', 'he'],
    ['=LEFT("hello")', 'h'],
    ['=LEFT("hi",10)', 'hi'],
    ['=LEFT("hi",-1)', e('#VALUE!')],
    ['=RIGHT("hello",3)', 'llo'],
    ['=RIGHT("hello",0)', ''],
    ['=MID("hello",2,3)', 'ell'],
    ['=MID("hello",10,3)', ''],
    ['=MID("hello",0,3)', e('#VALUE!')],
    ['=UPPER(#N/A)', e('#N/A')],
  ]);
});

describe('INDEX / MATCH', () => {
  const grid = { A1: 'a', A2: 'b', A3: 'c', B1: 1, B2: 2, B3: 3 };
  table([
    ['=INDEX(A1:B3,2,2)', 2, grid],
    ['=INDEX(A1:A3,3)', 'c', grid],
    ['=INDEX(A1:B1,2)', 'b', { A1: 'a', B1: 'b' }],
    ['=INDEX(A1:B3,4,1)', e('#REF!'), grid],
    ['=INDEX(A1:B3,0,1)', e('#VALUE!'), grid],
    ['=MATCH("b",A1:A3,0)', 2, grid],
    ['=MATCH("B",A1:A3,0)', 2, grid],
    ['=MATCH("z",A1:A3,0)', e('#N/A'), grid],
    ['=MATCH("c*",A1:A3,0)', 3, { A1: 'a', A2: 'b', A3: 'cat' }],
    ['=MATCH(5,B1:B3,1)', 3, grid],
    ['=MATCH(0,B1:B3,1)', e('#N/A'), grid],
    ['=MATCH(2,B1:B3)', 2, grid],
    ['=MATCH(2,B3:B1,-1)', 2, { B1: 3, B2: 2, B3: 1 }],
    ['=MATCH(1,A1:B3,0)', e('#N/A'), grid],
    ['=INDEX(A:A,MATCH("b",A:A,0))', 'b', grid],
  ]);
});
