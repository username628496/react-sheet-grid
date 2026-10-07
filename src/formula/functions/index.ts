import { DATE_FUNCTIONS } from './date';
import type { FunctionDef } from './helpers';
import { LOGIC_FUNCTIONS } from './logic';
import { LOOKUP_FUNCTIONS } from './lookup';
import { MATH_FUNCTIONS } from './math';
import { TEXT_FUNCTIONS } from './text';

export const FUNCTIONS: Readonly<Record<string, FunctionDef>> = {
  ...MATH_FUNCTIONS,
  ...LOGIC_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...DATE_FUNCTIONS,
};
