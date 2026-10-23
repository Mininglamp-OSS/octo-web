import { describe, expect, it } from 'vitest';
import { SUMMARY_SEARCH_TITLE_WINDOW, summarySearchSegments, summarySearchTooLong } from './summarySearch';
describe('summary search protocol', () => {
 it('uses Unicode code points for emoji and full-width source highlights', () => {
  expect(summarySearchSegments('😀ＯＣＴＯ', [[1,5]])).toEqual([{text:'😀',matched:false},{text:'ＯＣＴＯ',matched:true}]);
 });
 it('centers long topic snippets on the actual hit and ignores invalid offsets', () => {
  const parts=summarySearchSegments('a'.repeat(200)+'needle'+'z'.repeat(200), [[200,206],[-1,4],[500,600]],140);
  expect(parts.filter(p=>p.matched).map(p=>p.text).join('')).toBe('needle');
  expect(parts.map(p=>p.text).join('')).toMatch(/^….*needle.*…$/);
 });
 it('counts 100 supplementary characters without truncation', () => {
  expect(summarySearchTooLong('😀'.repeat(100))).toBe(false);
  expect(summarySearchTooLong('😀'.repeat(101))).toBe(true);
 });
 it('treats null or missing range arrays as plain text', () => {
  expect(summarySearchSegments('😀原文', null)).toEqual([{text:'😀原文',matched:false}]);
  expect(summarySearchSegments('😀原文', undefined)).toEqual([{text:'😀原文',matched:false}]);
 });
 it('keeps only a short context before a late CJK topic hit', () => {
  const parts = summarySearchSegments('前'.repeat(200)+'命中'+'后'.repeat(200), [[200,202]], 140);
  expect(parts[0]).toEqual({text:'…'+'前'.repeat(8),matched:false});
  expect(parts[1]).toEqual({text:'命中',matched:true});
 });
 it('leaves an unmatched long title whole instead of inventing ellipses', () => {
  const text = '标'.repeat(80);
  expect(summarySearchSegments(text, [], SUMMARY_SEARCH_TITLE_WINDOW)).toEqual([{text,matched:false}]);
  expect(summarySearchSegments(text, null, SUMMARY_SEARCH_TITLE_WINDOW)).toEqual([{text,matched:false}]);
 });
 it('keeps a late title hit inside the two-line title window', () => {
  const parts = summarySearchSegments('题'.repeat(60)+'命中', [[60,62]], SUMMARY_SEARCH_TITLE_WINDOW);
  expect(parts[0]).toEqual({text:'…'+'题'.repeat(8),matched:false});
  expect(parts[1]).toEqual({text:'命中',matched:true});
  expect(parts.map(p=>p.text).join('').length).toBeLessThanOrEqual(SUMMARY_SEARCH_TITLE_WINDOW + 2);
 });
});
