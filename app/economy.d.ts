export type PurchaseStatus = "purchased" | "equipped" | "already-equipped" | "insufficient";

export const weaponPrices: Readonly<{
  fist: 0;
  stick: 100;
  nunchaku: 300;
  grenade: 500;
  pistol: 500;
}>;

export type EconomyWeaponId = keyof typeof weaponPrices;

type PurchasableProfile = {
  coins: number;
  owned: EconomyWeaponId[];
  equipped: EconomyWeaponId;
};

type WinningProfile = {
  coins: number;
  wins: number;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function buyOrEquipProfiles<Profile extends PurchasableProfile>(
  profiles: [Profile, Profile],
  shopperIndex: 0 | 1,
  weaponId: EconomyWeaponId,
): {
  profiles: [Profile, Profile];
  status: PurchaseStatus;
  beforeCoins: number;
  afterCoins: number;
  spent: number;
};

export type RoundSettlementEntry = {
  player: number;
  weapon: EconomyWeaponId;
  listedFee: number;
  waivedFee: number;
  fee: number;
  reward: number;
  beforeCoins: number;
  afterCoins: number;
};

export function settleRoundOnce<Profile extends WinningProfile>(
  profiles: [Profile, Profile],
  battleId: number,
  winner: 0 | 1 | "draw" | null,
  usedWeapons: [EconomyWeaponId | null, EconomyWeaponId | null],
  settledRoundId: number | null,
  reward?: number,
): {
  profiles: [Profile, Profile];
  settledRoundId: number | null;
  settled: boolean;
  entries: RoundSettlementEntry[];
};

export function reconcileProfilePurchases<Profile extends PurchasableProfile & WinningProfile>(
  profile: Profile,
  rewardPerWin?: number,
): {
  profile: Profile;
  repaired: boolean;
};

export function readStoredProfiles(storage: StorageLike, key: string): unknown;
export function writeStoredProfiles(storage: StorageLike, key: string, profiles: unknown): void;
