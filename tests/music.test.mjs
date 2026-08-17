import assert from "node:assert/strict";
import test from "node:test";

import { GameMusicEngine, musicTracks, noteToFrequency } from "../app/game-audio.js";

test("ships four distinct original game-music modes", () => {
  assert.deepEqual(Object.keys(musicTracks), ["select", "armory", "fight", "victory"]);
  assert.equal(new Set(Object.values(musicTracks).map((track) => track.label)).size, 4);
  assert.ok(musicTracks.fight.stepMs < musicTracks.select.stepMs);
  assert.ok(musicTracks.victory.lead.includes("C6"));
});

test("every melody note is valid and locally synthesizable", () => {
  for (const track of Object.values(musicTracks)) {
    assert.ok(track.lead.length >= 16);
    assert.equal(track.lead.length, track.bass.length);
    for (const note of [...track.lead, ...track.bass]) {
      const frequency = noteToFrequency(note);
      if (note === null) assert.equal(frequency, null);
      else assert.ok(Number.isFinite(frequency) && frequency > 20 && frequency < 5000, note);
    }
  }
});

test("uses concert pitch and rejects malformed notes", () => {
  assert.equal(noteToFrequency("A4"), 440);
  assert.ok(Math.abs(noteToFrequency("C4") - 261.6256) < 0.001);
  assert.throws(() => noteToFrequency("banana"), RangeError);
});

test("the music engine keeps one scheduler, plays victory once, and cleans up", async () => {
  const previousWindow = globalThis.window;
  const intervals = new Map();
  let nextInterval = 1;

  class FakeAudioParam {
    constructor() { this.value = 0; }
    cancelScheduledValues() {}
    setTargetAtTime() {}
    setValueAtTime() {}
    exponentialRampToValueAtTime() {}
  }
  class FakeNode {
    connect() { return this; }
  }
  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.destination = new FakeNode();
    }
    createGain() { const node = new FakeNode(); node.gain = new FakeAudioParam(); return node; }
    createOscillator() {
      const node = new FakeNode();
      node.frequency = new FakeAudioParam();
      node.start = () => {};
      node.stop = () => {};
      return node;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }

  globalThis.window = {
    AudioContext: FakeAudioContext,
    setInterval(callback) { const id = nextInterval++; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
  };

  try {
    const engine = new GameMusicEngine();
    assert.equal(await engine.play("select"), true);
    const firstScheduler = [...intervals.keys()][0];
    assert.equal(intervals.size, 1);

    assert.equal(await engine.play("select"), true);
    assert.deepEqual([...intervals.keys()], [firstScheduler]);

    assert.equal(await engine.play("fight"), true);
    assert.equal(intervals.size, 1);
    assert.notEqual([...intervals.keys()][0], firstScheduler);

    assert.equal(await engine.play("victory"), true);
    const victoryTick = [...intervals.values()][0];
    for (let step = 0; step < musicTracks.victory.lead.length; step += 1) victoryTick();
    assert.equal(intervals.size, 0);

    await engine.dispose();
    assert.equal(engine.isPlaying, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
