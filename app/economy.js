export const weaponPrices = Object.freeze({
  fist: 0,
  stick: 100,
  nunchaku: 300,
  grenade: 500,
  pistol: 500,
});

/**
 * Apply one armory action as a single immutable transaction.
 * Prices come from the economy itself so no caller can accidentally bypass them.
 */
export function buyOrEquipProfiles(profiles, shopperIndex, weaponId) {
  if (shopperIndex !== 0 && shopperIndex !== 1) {
    throw new RangeError("shopperIndex must be 0 or 1");
  }
  if (!Object.prototype.hasOwnProperty.call(weaponPrices, weaponId)) {
    throw new RangeError("unknown weapon");
  }

  const buyer = profiles[shopperIndex];
  const beforeCoins = buyer.coins;
  const price = weaponPrices[weaponId];

  if (buyer.owned.includes(weaponId)) {
    const status = buyer.equipped === weaponId ? "already-equipped" : "equipped";
    const nextBuyer = status === "already-equipped" ? buyer : { ...buyer, equipped: weaponId };
    const nextProfiles = replaceProfile(profiles, shopperIndex, nextBuyer);
    return { profiles: nextProfiles, status, beforeCoins, afterCoins: beforeCoins, spent: 0 };
  }

  if (beforeCoins < price) {
    return { profiles, status: "insufficient", beforeCoins, afterCoins: beforeCoins, spent: 0 };
  }

  const afterCoins = beforeCoins - price;
  const nextBuyer = {
    ...buyer,
    coins: afterCoins,
    owned: [...buyer.owned, weaponId],
    equipped: weaponId,
  };
  return {
    profiles: replaceProfile(profiles, shopperIndex, nextBuyer),
    status: "purchased",
    beforeCoins,
    afterCoins,
    spent: price,
  };
}

/**
 * Settle a finished round exactly once. The winner receives the round reward,
 * and their paid-weapon usage fee is waived. The loser pays once for the paid
 * weapon they actually attacked with; in a draw, both players pay. Scores may
 * become negative so every non-waived fee is charged in full.
 */
export function settleRoundOnce(profiles, battleId, winner, usedWeapons, settledRoundId, reward = 200) {
  if (winner === null || winner === undefined || (settledRoundId !== null && battleId <= settledRoundId)) {
    return { profiles, settledRoundId, settled: false, entries: [] };
  }

  const winnerIndex = winner === 0 || winner === 1 ? winner : null;
  const entries = profiles.map((profile, player) => {
    const candidate = usedWeapons[player];
    if (candidate !== null && candidate !== undefined && !Object.prototype.hasOwnProperty.call(weaponPrices, candidate)) {
      throw new RangeError("unknown used weapon");
    }
    const weapon = candidate ?? "fist";
    const listedFee = weaponPrices[weapon];
    const waivedFee = winnerIndex === player ? listedFee : 0;
    const fee = listedFee - waivedFee;
    const roundReward = winnerIndex === player ? reward : 0;
    const beforeCoins = profile.coins;
    const afterCoins = beforeCoins + roundReward - fee;

    return { player, weapon, listedFee, waivedFee, fee, reward: roundReward, beforeCoins, afterCoins };
  });

  const nextProfiles = profiles.map((profile, player) => ({
    ...profile,
    coins: entries[player].afterCoins,
    wins: profile.wins + (winnerIndex === player ? 1 : 0),
  }));

  return {
    profiles: nextProfiles,
    settledRoundId: battleId,
    settled: true,
    entries,
  };
}

/**
 * Repair legacy local saves that contain paid weapons without enough recorded
 * winnings and spending to have unlocked them.
 */
export function reconcileProfilePurchases(profile, rewardPerWin = 200) {
  const spendBudget = Math.max(0, profile.wins * rewardPerWin - profile.coins);
  const owned = ["fist"];
  const seen = new Set(owned);
  let accountedSpend = 0;
  let repaired = !profile.owned.includes("fist");

  for (const weaponId of profile.owned) {
    if (weaponId === "fist") continue;
    if (seen.has(weaponId) || !Object.prototype.hasOwnProperty.call(weaponPrices, weaponId)) {
      repaired = true;
      continue;
    }

    const price = weaponPrices[weaponId];
    if (accountedSpend + price > spendBudget) {
      repaired = true;
      continue;
    }

    seen.add(weaponId);
    owned.push(weaponId);
    accountedSpend += price;
  }

  const equipped = owned.includes(profile.equipped) ? profile.equipped : "fist";
  if (equipped !== profile.equipped || owned.length !== profile.owned.length) repaired = true;
  return { profile: { ...profile, owned, equipped }, repaired };
}

export function readStoredProfiles(storage, key) {
  const saved = storage.getItem(key);
  return saved ? JSON.parse(saved) : null;
}

export function writeStoredProfiles(storage, key, profiles) {
  storage.setItem(key, JSON.stringify(profiles));
}

function replaceProfile(profiles, index, profile) {
  return index === 0 ? [profile, profiles[1]] : [profiles[0], profile];
}
