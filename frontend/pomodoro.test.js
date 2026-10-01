import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { advanceCompletedPhase, mountPomodoro, remainingAt, ringProgressFor, timerState } from '../src/main/resources/static/pomodoro.js';

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

test('timer controls expose an accessible name for collapsing the timer',()=>{
  const dom=new JSDOM('<!doctype html><title>StudySpace</title><body></body>',{url:'http://localhost/'});
  const previousDocument=globalThis.document,previousWindow=globalThis.window,previousLocalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousSetInterval=globalThis.setInterval;
  globalThis.document=dom.window.document;
  globalThis.window=dom.window;
  globalThis.localStorage=dom.window.localStorage;
  globalThis.setInterval=()=>0;
  try{
    mountPomodoro('a11y-test');
    const minimize=dom.window.document.querySelector('.pomodoro-minimize');
    assert.equal(minimize.textContent,'접기');
    assert.equal(minimize.getAttribute('aria-label'),'타이머 접기');
    const ring=dom.window.document.querySelector('.pomodoro-ring');
    assert.equal(ring.getAttribute('aria-label'),'타이머 펼치기');
    ring.click();
    assert.equal(ring.getAttribute('aria-label'),'타이머 접기');
  }finally{
    globalThis.document=previousDocument;
    globalThis.window=previousWindow;
    if(previousLocalStorage)Object.defineProperty(globalThis,'localStorage',previousLocalStorage);
    else delete globalThis.localStorage;
    globalThis.setInterval=previousSetInterval;
    dom.window.close();
  }
});

test('collapsing an expanded timer on the dashboard restores its compact safe position',()=>{
  const dom=new JSDOM('<!doctype html><title>StudySpace</title><body><main id="dashboard"></main></body>',{url:'http://localhost/'});
  const previousDocument=globalThis.document,previousWindow=globalThis.window,previousLocalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousSetInterval=globalThis.setInterval;
  globalThis.document=dom.window.document;
  globalThis.window=dom.window;
  globalThis.localStorage=dom.window.localStorage;
  globalThis.setInterval=()=>0;
  try{
    mountPomodoro('dashboard-collapse-test');
    const root=dom.window.document.querySelector('.pomodoro');
    const ring=dom.window.document.querySelector('.pomodoro-ring');
    const minimize=dom.window.document.querySelector('.pomodoro-minimize');
    assert.ok(root.classList.contains('dashboard-context-compact'));
    ring.click();
    assert.ok(!root.classList.contains('minimized'));
    assert.ok(!root.classList.contains('dashboard-context-compact'));
    minimize.click();
    assert.ok(root.classList.contains('minimized'));
    assert.ok(root.classList.contains('dashboard-context-compact'));
    assert.equal(ring.getAttribute('aria-label'),'타이머 펼치기');
  }finally{
    globalThis.document=previousDocument;
    globalThis.window=previousWindow;
    if(previousLocalStorage)Object.defineProperty(globalThis,'localStorage',previousLocalStorage);
    else delete globalThis.localStorage;
    globalThis.setInterval=previousSetInterval;
    dom.window.close();
  }
});
