import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCompletedPhase, remainingAt, ringProgressFor, timerState } from '../src/main/resources/static/pomodoro.js';

test('running timer derives remaining time from the absolute deadline',()=>{
  const state={...timerState(),running:true,endAt:1_600_000,remainingMs:1_500_000};
  assert.equal(remainingAt(state,100_000),1_500_000);assert.equal(remainingAt(state,1_599_250),750);assert.equal(remainingAt(state,1_700_000),0);
});

test('paused focus and break timers keep their stored remaining time',()=>{
  assert.equal(remainingAt({...timerState(),remainingMs:123_456},9_999_999),123_456);assert.equal(timerState('break').remainingMs,300_000);
});

test('one completed focus timer starts one rest, then returns to a paused focus timer',()=>{
  const focus={...timerState(),focusMs:25*60*1000,breakMs:10*60*1000,focusLeft:0,remainingMs:0,endAt:0,running:true};
  const rest=advanceCompletedPhase(focus,1000);
  assert.equal(rest.phase,'break');assert.equal(rest.running,true);assert.equal(rest.remainingMs,10*60*1000);assert.equal(rest.endAt,10*60*1000+1000);
  const focusAgain=advanceCompletedPhase({...rest,breakLeft:0,remainingMs:0,endAt:1000,running:true},2000);
  assert.equal(focusAgain.phase,'focus');assert.equal(focusAgain.running,false);assert.equal(focusAgain.endAt,null);assert.equal(focusAgain.remainingMs,25*60*1000);
});

test('timer ring starts at 70 percent for focus and 40 percent for a five-minute rest',()=>{
  assert.deepEqual(ringProgressFor(25*60*1000,'focus'),{progress:0.7,overflow:0});
  assert.ok(Math.abs(ringProgressFor(5*60*1000,'break').progress-0.4)<1e-9);
  assert.equal(ringProgressFor(10*60*1000,'break').progress,1);
  assert.equal(ringProgressFor(10*60*1000,'break').overflow,0);
});

test('inner overtime ring reaches full exactly at each mode maximum',()=>{
  const focus=ringProgressFor(90*60*1000,'focus'),rest=ringProgressFor(90*60*1000,'break');
  assert.equal(focus.progress,1);assert.equal(focus.overflow,1);
  assert.equal(rest.progress,1);assert.equal(rest.overflow,1);
  assert.ok(Math.abs(ringProgressFor(50*60*1000,'break').overflow-0.5)<1e-9);
});
