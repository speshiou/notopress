import { expect, it } from 'vitest';
import { compareStrings } from './order';

it('orders keys by UTF-16 code unit, independent of machine locale', () => {
  expect(['示例', 'z', 'A', 'a'].sort((left, right) => compareStrings({ left, right }))).toEqual(['A', 'a', 'z', '示例']);
});
