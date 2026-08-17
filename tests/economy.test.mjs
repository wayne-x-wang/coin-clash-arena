import assert from "node:assert/strict";
import test from "node:test";

import {
  buyOrEquipProfiles,
  readStoredProfiles,
  reconcileProfilePurchases,
  settleRoundOnce,
  weaponPrices,
  writeStoredProfiles,
} from "../app/economy.js";

function freshProfiles() {
  return [
    { hero: 0, coins: 200, owned: ["fist"], equipped: "fist", wins: 1 },
    { hero: 3, coins: 0, owned: ["fist"], equipped: "fist", wins: 0 },
  ];
}

test("buying the 100-coin stick changes 200 coins to 100 immediately", () => {
  const before = freshProfiles();
  const result = buyOrEquipProfiles(before, 0, "stick");

  assert.equal(result.status, "purchased");
  assert.equal(result.beforeCoins, 200);
  assert.equal(result.spent, 100);
  assert.equal(result.afterCoins, 100);
  assert.equal(result.profiles[0].coins, 100);
  assert.deepEqual(result.profiles[0].owned, ["fist", "stick"]);
  assert.equal(result.profiles[0].equipped, "stick");
  assert.deepEqual(result.profiles[1], before[1]);
});

test("switching to an unlocked stick does not pay the armory unlock fee twice", () => {
  const purchased = buyOrEquipProfiles(freshProfiles(), 0, "stick");
  const equippedAgain = buyOrEquipProfiles(purchased.profiles, 0, "stick");

  assert.equal(equippedAgain.status, "already-equipped");
  assert.equal(equippedAgain.spent, 0);
  assert.equal(equippedAgain.profiles[0].coins, 100);
  assert.equal(equippedAgain.profiles[0].owned.filter((weapon) => weapon === "stick").length, 1);
});

test("a deducted balance survives the same storage round-trip used by the game", () => {
  const purchased = buyOrEquipProfiles(freshProfiles(), 0, "stick");
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  writeStoredProfiles(storage, "coin-battle-profiles-v1", purchased.profiles);
  const restored = readStoredProfiles(storage, "coin-battle-profiles-v1");

  assert.deepEqual(restored, purchased.profiles);
  assert.equal(restored[0].coins, 100);
});

test("a fist-only draw has no reward and no weapon fee", () => {
  const before = freshProfiles();
  const result = settleRoundOnce(before, 21, "draw", [null, "fist"], null);

  assert.equal(result.settled, true);
  assert.deepEqual(result.entries.map((entry) => entry.fee), [0, 0]);
  assert.deepEqual(result.entries.map((entry) => entry.reward), [0, 0]);
  assert.deepEqual(result.profiles, before);
});

test("equipping a paid weapon without actually attacking does not charge a usage fee", () => {
  const profiles = freshProfiles();
  profiles[0] = { ...profiles[0], coins: 100, owned: ["fist", "stick"], equipped: "stick" };
  const result = settleRoundOnce(profiles, 22, 1, [null, null], null);

  assert.equal(result.entries[0].fee, 0);
  assert.equal(result.profiles[0].coins, 100);
  assert.equal(result.entries[1].reward, 200);
  assert.equal(result.profiles[1].coins, 200);
});

test("winner receives 200 and has their paid-weapon usage fee waived", () => {
  const profiles = freshProfiles();
  profiles[0] = { ...profiles[0], coins: 600, owned: ["fist", "nunchaku"], equipped: "nunchaku" };
  profiles[1] = { ...profiles[1], coins: 100, owned: ["fist", "pistol"], equipped: "pistol" };
  const result = settleRoundOnce(profiles, 23, 0, ["nunchaku", "pistol"], null);

  assert.deepEqual(result.entries.map((entry) => entry.listedFee), [300, 500]);
  assert.deepEqual(result.entries.map((entry) => entry.waivedFee), [300, 0]);
  assert.deepEqual(result.entries.map((entry) => entry.fee), [0, 500]);
  assert.deepEqual(result.entries.map((entry) => entry.reward), [200, 0]);
  assert.equal(result.profiles[0].coins, 800);
  assert.equal(result.profiles[0].wins, profiles[0].wins + 1);
  assert.equal(result.profiles[1].coins, -400);
  assert.equal(result.profiles[1].wins, profiles[1].wins);
});

test("a finished round cannot charge its reward or usage fees twice", () => {
  const profiles = freshProfiles();
  profiles[1] = { ...profiles[1], coins: 10, owned: ["fist", "grenade"], equipped: "grenade" };
  const first = settleRoundOnce(profiles, 24, 0, ["stick", "grenade"], null);
  const replay = settleRoundOnce(first.profiles, 24, 0, ["stick", "grenade"], first.settledRoundId);

  assert.equal(first.settled, true);
  assert.equal(first.profiles[0].coins, 400);
  assert.equal(first.profiles[1].coins, -490);
  assert.equal(replay.settled, false);
  assert.deepEqual(replay.entries, []);
  assert.deepEqual(replay.profiles, first.profiles);
});

test("usage fees subtract in full and negative scores survive local storage", () => {
  const profiles = freshProfiles();
  profiles[0] = { ...profiles[0], coins: 50, owned: ["fist", "stick"], equipped: "stick" };
  const settled = settleRoundOnce(profiles, 25, "draw", ["stick", null], null);
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(settled.profiles[0].coins, -50);
  writeStoredProfiles(storage, "coin-battle-profiles-v1", settled.profiles);
  assert.equal(readStoredProfiles(storage, "coin-battle-profiles-v1")[0].coins, -50);
});

test("winning with a pistol charges no usage fee even from a zero score", () => {
  const profiles = freshProfiles();
  profiles[0] = { ...profiles[0], coins: 0, owned: ["fist", "pistol"], equipped: "pistol" };
  const result = settleRoundOnce(profiles, 26, 0, ["pistol", null], null);

  assert.equal(result.entries[0].listedFee, 500);
  assert.equal(result.entries[0].waivedFee, 500);
  assert.equal(result.entries[0].fee, 0);
  assert.equal(result.entries[0].reward, 200);
  assert.equal(result.profiles[0].coins, 200);
});

test("every paid weapon is free to use for the winner", () => {
  for (const [index, weaponId] of ["stick", "nunchaku", "grenade", "pistol"].entries()) {
    const profiles = freshProfiles();
    profiles[0] = { ...profiles[0], coins: 17, owned: ["fist", weaponId], equipped: weaponId };
    const result = settleRoundOnce(profiles, 30 + index, 0, [weaponId, null], null);

    assert.equal(result.entries[0].listedFee, weaponPrices[weaponId], weaponId);
    assert.equal(result.entries[0].waivedFee, weaponPrices[weaponId], weaponId);
    assert.equal(result.entries[0].fee, 0, weaponId);
    assert.equal(result.profiles[0].coins, 217, weaponId);
  }
});

test("buying a pistol and then winning charges only the unlock price", () => {
  const profiles = freshProfiles();
  profiles[0] = { ...profiles[0], coins: 600 };
  const purchased = buyOrEquipProfiles(profiles, 0, "pistol");
  const settled = settleRoundOnce(purchased.profiles, 34, 0, ["pistol", null], null);

  assert.equal(purchased.profiles[0].coins, 100);
  assert.equal(settled.entries[0].waivedFee, 500);
  assert.equal(settled.entries[0].fee, 0);
  assert.equal(settled.profiles[0].coins, 300);
});

test("a draw waives neither player's paid-weapon usage fee", () => {
  const profiles = freshProfiles();
  profiles[0] = { ...profiles[0], coins: 20, owned: ["fist", "nunchaku"], equipped: "nunchaku" };
  profiles[1] = { ...profiles[1], coins: 40, owned: ["fist", "pistol"], equipped: "pistol" };
  const result = settleRoundOnce(profiles, 35, "draw", ["nunchaku", "pistol"], null);

  assert.deepEqual(result.entries.map((entry) => entry.waivedFee), [0, 0]);
  assert.deepEqual(result.entries.map((entry) => entry.fee), [300, 500]);
  assert.deepEqual(result.entries.map((entry) => entry.reward), [0, 0]);
  assert.deepEqual(result.profiles.map((profile) => profile.coins), [-280, -460]);
});

test("200 coins cannot buy the 500-coin pistol", () => {
  const before = freshProfiles();
  const result = buyOrEquipProfiles(before, 0, "pistol");

  assert.equal(weaponPrices.pistol, 500);
  assert.equal(result.status, "insufficient");
  assert.equal(result.spent, 0);
  assert.equal(result.profiles[0].coins, 200);
  assert.equal(result.profiles[0].owned.includes("pistol"), false);
  assert.equal(result.profiles[0].equipped, "fist");
});

test("the pistol unlocks at exactly 500 coins and leaves a zero balance", () => {
  const profiles = freshProfiles();
  profiles[0] = { ...profiles[0], coins: 500 };
  const result = buyOrEquipProfiles(profiles, 0, "pistol");

  assert.equal(result.status, "purchased");
  assert.equal(result.beforeCoins, 500);
  assert.equal(result.spent, 500);
  assert.equal(result.afterCoins, 0);
  assert.equal(result.profiles[0].coins, 0);
  assert.equal(result.profiles[0].owned.includes("pistol"), true);
  assert.equal(result.profiles[0].equipped, "pistol");
});

test("every first-time weapon purchase subtracts its exact listed price", () => {
  for (const weaponId of ["stick", "nunchaku", "grenade", "pistol"]) {
    const price = weaponPrices[weaponId];
    const profiles = freshProfiles();
    profiles[0] = { ...profiles[0], coins: price };

    const result = buyOrEquipProfiles(profiles, 0, weaponId);

    assert.equal(result.status, "purchased", weaponId);
    assert.equal(result.beforeCoins, price, weaponId);
    assert.equal(result.spent, price, weaponId);
    assert.equal(result.beforeCoins - result.spent, result.afterCoins, weaponId);
    assert.equal(result.profiles[0].coins, 0, weaponId);
  }
});

test("buying a stick first does not let the remaining 100 coins buy a pistol", () => {
  const stick = buyOrEquipProfiles(freshProfiles(), 0, "stick");
  const blocked = buyOrEquipProfiles(stick.profiles, 0, "pistol");

  assert.equal(blocked.status, "insufficient");
  assert.equal(blocked.profiles[0].coins, 100);
  assert.deepEqual(blocked.profiles[0].owned, ["fist", "stick"]);
  assert.equal(blocked.profiles[0].equipped, "stick");
});

test("a legacy save cannot keep a pistol that its winnings never paid for", () => {
  const impossible = {
    hero: 0,
    coins: 200,
    wins: 1,
    owned: ["fist", "pistol"],
    equipped: "pistol",
  };
  const result = reconcileProfilePurchases(impossible);

  assert.equal(result.repaired, true);
  assert.deepEqual(result.profile.owned, ["fist"]);
  assert.equal(result.profile.equipped, "fist");
  assert.equal(result.profile.coins, 200);
});

test("a pistol with a valid purchase history stays unlocked for later rounds", () => {
  const legitimate = {
    hero: 0,
    coins: 100,
    wins: 3,
    owned: ["fist", "pistol"],
    equipped: "fist",
  };
  const reconciled = reconcileProfilePurchases(legitimate);
  const equipped = buyOrEquipProfiles([reconciled.profile, freshProfiles()[1]], 0, "pistol");

  assert.equal(reconciled.repaired, false);
  assert.equal(equipped.status, "equipped");
  assert.equal(equipped.spent, 0);
  assert.equal(equipped.profiles[0].coins, 100);
});
