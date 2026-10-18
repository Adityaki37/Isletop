import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeFunBoard} from '../lib/fun-maps';
import {makeLakesBoard} from '../lib/lakes';
import predecessor from './fixtures/pre-cleanup-layouts.json';
for(const map of ['diamond','pond','gear','twirl','lakes'] as const){
 test(`${map}: complete fixed board matches the pre-cleanup predecessor`,()=>{
  const board=map==='lakes'?makeLakesBoard():makeFunBoard(map);
  assert.equal(createHash('sha256').update(JSON.stringify(board)).digest('hex'),predecessor.hashes[map]);
 });
}
