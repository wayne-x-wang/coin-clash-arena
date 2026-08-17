"use client";

import { useEffect, useRef, useState } from "react";

import { GameMusicEngine, musicTracks } from "./game-audio.js";
import type { MusicMode } from "./game-audio.js";
import {
  buyOrEquipProfiles,
  readStoredProfiles,
  reconcileProfilePurchases,
  settleRoundOnce,
  weaponPrices,
  writeStoredProfiles,
} from "./economy.js";
import type { PurchaseStatus } from "./economy.js";

type Stage = "select" | "armory" | "fight";
type WeaponId = "fist" | "stick" | "nunchaku" | "grenade" | "pistol";
type Winner = 0 | 1 | "draw" | null;

type Profile = {
  hero: number;
  coins: number;
  owned: WeaponId[];
  equipped: WeaponId;
  wins: number;
};

type PurchaseReceipt = {
  id: number;
  player: 0 | 1;
  weapon: WeaponId;
  status: PurchaseStatus;
  beforeCoins: number;
  afterCoins: number;
  spent: number;
};

type PendingPurchase = {
  player: 0 | 1;
  weapon: WeaponId;
};

type RoundSettlementEntry = {
  player: number;
  weapon: WeaponId;
  listedFee: number;
  waivedFee: number;
  fee: number;
  reward: number;
  beforeCoins: number;
  afterCoins: number;
};

type RoundSettlement = {
  battleId: number;
  entries: [RoundSettlementEntry, RoundSettlementEntry];
};

type FighterState = {
  x: number;
  y: number;
  vy: number;
  hp: number;
  crouch: boolean;
  ammo: number;
  cooldownUntil: number;
  attackingUntil: number;
  hitUntil: number;
};

type Projectile = {
  id: number;
  owner: 0 | 1;
  type: "bullet" | "grenade";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
};

type Explosion = { id: number; x: number; life: number };

type BattleState = {
  id: number;
  fighters: [FighterState, FighterState];
  usedWeapons: [WeaponId | null, WeaponId | null];
  projectiles: Projectile[];
  explosions: Explosion[];
  countdown: number;
  timeLeft: number;
  winner: Winner;
  reason: "KO" | "TIME" | null;
  paused: boolean;
};

const heroes = [
  { name: "艾莎公主", short: "艾莎", icon: "❄", tone: "ice", motto: "冰箱门忘关了" },
  { name: "白雪公主", short: "白雪", icon: "●", tone: "apple", motto: "苹果帽太大啦" },
  { name: "量子战队", short: "量子", icon: "Q", tone: "quantum", motto: "信号正在转圈" },
  { name: "机械恐龙", short: "恐龙", icon: "R", tone: "dino", motto: "小短手也要赢" },
  { name: "安娜公主", short: "安娜", icon: "♥", tone: "anna", motto: "围巾比人还大" },
  { name: "超级玛丽欧", short: "玛丽欧", icon: "M", tone: "mario", motto: "胡子先到终点" },
  { name: "奥特曼", short: "奥特曼", icon: "✦", tone: "ultra", motto: "眼睛自带远光" },
  { name: "灰色机械怪兽", short: "怪兽", icon: "G", tone: "mecha", motto: "螺丝今天放假" },
] as const;

const weapons: Record<WeaponId, {
  name: string;
  price: number;
  damage: number;
  cooldown: number;
  range: number;
  icon: string;
  detail: string;
  ammo: number;
}> = {
  fist: { name: "拳头", price: weaponPrices.fist, damage: 8, cooldown: 380, range: 8.5, icon: "✊", detail: "免费·无限使用", ammo: -1 },
  stick: { name: "大棍子", price: weaponPrices.stick, damage: 14, cooldown: 650, range: 13, icon: "━", detail: "近战·攻击范围更远", ammo: -1 },
  nunchaku: { name: "双截棍", price: weaponPrices.nunchaku, damage: 18, cooldown: 850, range: 11, icon: "●━●", detail: "近战·强力两连击", ammo: -1 },
  grenade: { name: "手榴弹", price: weaponPrices.grenade, damage: 32, cooldown: 2500, range: 14, icon: "✹", detail: "远程·每局 2 枚", ammo: 2 },
  pistol: { name: "手枪", price: weaponPrices.pistol, damage: 11, cooldown: 480, range: 100, icon: "┑", detail: "远程·每局 6 发", ammo: 6 },
};

const weaponOrder: WeaponId[] = ["fist", "stick", "nunchaku", "grenade", "pistol"];
const profileStorageKey = "coin-battle-profiles-v1";
const musicPreferenceKey = "coin-battle-music-v1";
const initialProfiles: [Profile, Profile] = [
  { hero: 0, coins: 0, owned: ["fist"], equipped: "fist", wins: 0 },
  { hero: 3, coins: 0, owned: ["fist"], equipped: "fist", wins: 0 },
];

const controls = [
  { left: "a", right: "d", jump: "w", crouch: "s", attack: "f" },
  { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", crouch: "ArrowDown", attack: "l" },
] as const;

export default function Home() {
  const [stage, setStage] = useState<Stage>("select");
  const [profiles, setProfiles] = useState<[Profile, Profile]>(initialProfiles);
  const [activePicker, setActivePicker] = useState<0 | 1>(0);
  const [activeShopper, setActiveShopper] = useState<0 | 1>(0);
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [roundSettlement, setRoundSettlement] = useState<RoundSettlement | null>(null);
  const [purchaseReceipt, setPurchaseReceipt] = useState<PurchaseReceipt | null>(null);
  const [saveRepairNotice, setSaveRepairNotice] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const keysRef = useRef(new Set<string>());
  const profilesRef = useRef(profiles);
  const stageRef = useRef(stage);
  const settledRoundRef = useRef<number | null>(null);
  const roundIdRef = useRef(0);
  const projectileIdRef = useRef(1);
  const receiptIdRef = useRef(0);
  const musicEngineRef = useRef<GameMusicEngine | null>(null);
  const musicModeRef = useRef<MusicMode>("select");

  useEffect(() => { profilesRef.current = profiles; }, [profiles]);
  useEffect(() => { stageRef.current = stage; }, [stage]);

  useEffect(() => {
    const loadSavedGame = window.setTimeout(() => {
      try {
        const saved = readStoredProfiles(localStorage, profileStorageKey);
        if (saved) {
          const restored = sanitiseProfiles(saved);
          profilesRef.current = restored.profiles;
          setProfiles(restored.profiles);
          setSaveRepairNotice(restored.repaired);
        }
        if (localStorage.getItem(musicPreferenceKey) === "on") setMusicEnabled(true);
      } catch { /* A fresh game is a safe fallback. */ }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(loadSavedGame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      writeStoredProfiles(localStorage, profileStorageKey, profiles);
    } catch { /* Private browsing can disable device storage. */ }
  }, [profiles, hydrated]);

  useEffect(() => {
    if (stage !== "fight") return;
    let previousTick = performance.now();
    const timer = window.setInterval(() => {
      const tick = performance.now();
      const elapsed = Math.min(0.05, Math.max(0, (tick - previousTick) / 1000));
      previousTick = tick;
      setBattle((current) => current ? updateBattle(current, keysRef.current, elapsed) : current);
    }, 16);
    return () => window.clearInterval(timer);
  }, [stage]);

  const battleId = battle?.id;
  const battleWinner = battle?.winner;
  const playerOneUsedWeapon = battle?.usedWeapons[0] ?? null;
  const playerTwoUsedWeapon = battle?.usedWeapons[1] ?? null;
  const musicMode: MusicMode = stage === "fight"
    ? battleWinner === null || battleWinner === undefined ? "fight" : "victory"
    : stage;
  const musicPaused = stage === "fight" && Boolean(battle?.paused);

  useEffect(() => {
    musicModeRef.current = musicMode;
    const engine = musicEngineRef.current;
    if (!musicEnabled || !musicPlaying || !engine) return;
    if (musicPaused) {
      engine.stop();
      return;
    }
    void engine.play(musicMode);
  }, [musicEnabled, musicMode, musicPaused, musicPlaying]);

  useEffect(() => {
    if (!musicEnabled || musicPlaying) return;
    let attempted = false;
    const unlockMusic = () => {
      if (attempted) return;
      attempted = true;
      const engine = musicEngineRef.current ?? new GameMusicEngine();
      musicEngineRef.current = engine;
      void engine.play(musicModeRef.current).then((started) => {
        setMusicPlaying(started);
        if (!started) attempted = false;
      });
    };
    window.addEventListener("pointerdown", unlockMusic, { passive: true });
    window.addEventListener("keydown", unlockMusic);
    return () => {
      window.removeEventListener("pointerdown", unlockMusic);
      window.removeEventListener("keydown", unlockMusic);
    };
  }, [musicEnabled, musicPlaying]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const engine = musicEngineRef.current;
      if (!engine || !musicEnabled) return;
      if (document.hidden) {
        engine.stop();
        setMusicPlaying(false);
      } else {
        void engine.play(musicModeRef.current).then(setMusicPlaying);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [musicEnabled]);

  useEffect(() => () => {
    const engine = musicEngineRef.current;
    musicEngineRef.current = null;
    if (engine) void engine.dispose();
  }, []);

  useEffect(() => {
    if (!battleId || battleWinner === null || battleWinner === undefined) return;
    const result = settleRoundOnce(
      profilesRef.current,
      battleId,
      battleWinner,
      [playerOneUsedWeapon, playerTwoUsedWeapon],
      settledRoundRef.current,
      200,
    );
    if (!result.settled) return;
    settledRoundRef.current = result.settledRoundId;
    profilesRef.current = result.profiles;
    const entries = result.entries as [RoundSettlementEntry, RoundSettlementEntry];
    setRoundSettlement({ battleId, entries });
    setProfiles(result.profiles);
    if (hydrated) {
      try {
        writeStoredProfiles(localStorage, profileStorageKey, result.profiles);
      } catch { /* The completed round still stays visible when device storage is unavailable. */ }
    }
  }, [battleWinner, battleId, playerOneUsedWeapon, playerTwoUsedWeapon, hydrated]);

  const tryJump = (player: 0 | 1) => {
    setBattle((current) => {
      if (!current || current.winner !== null || current.countdown > 0 || current.paused) return current;
      const next = cloneBattle(current);
      const fighter = next.fighters[player];
      if (fighter.y <= 0.5) {
        fighter.y = 1;
        fighter.vy = 360;
        fighter.crouch = false;
      }
      return next;
    });
  };

  const performAttack = (player: 0 | 1) => {
    setBattle((current) => {
      if (!current || current.winner !== null || current.countdown > 0 || current.paused) return current;
      const now = Date.now();
      const next = cloneBattle(current);
      const attacker = next.fighters[player];
      const targetIndex = (player === 0 ? 1 : 0) as 0 | 1;
      const target = next.fighters[targetIndex];
      const selected = profilesRef.current[player].equipped;
      const effective: WeaponId = weapons[selected].ammo > 0 && attacker.ammo <= 0 ? "fist" : selected;
      const weapon = weapons[effective];
      if (attacker.cooldownUntil > now) return current;

      attacker.cooldownUntil = now + weapon.cooldown;
      attacker.attackingUntil = now + Math.min(340, Math.round(weapon.cooldown * 0.62));
      if (effective !== "fist" && next.usedWeapons[player] === null) next.usedWeapons[player] = effective;
      const direction = target.x >= attacker.x ? 1 : -1;

      if (effective === "pistol") {
        attacker.ammo -= 1;
        next.projectiles.push({
          id: projectileIdRef.current++, owner: player, type: "bullet", x: attacker.x + direction * 4,
          y: attacker.y + (attacker.crouch ? 25 : 43), vx: direction * 72, vy: 0, age: 0,
        });
      } else if (effective === "grenade") {
        attacker.ammo -= 1;
        next.projectiles.push({
          id: projectileIdRef.current++, owner: player, type: "grenade", x: attacker.x + direction * 3,
          y: attacker.y + 38, vx: direction * 30, vy: 75, age: 0,
        });
      } else if (Math.abs(target.x - attacker.x) <= weapon.range && Math.abs(target.y - attacker.y) < 42) {
        damageFighter(next, targetIndex, weapon.damage, direction * (effective === "nunchaku" ? 4.5 : 3), now);
      }

      return resolveKnockout(next);
    });
  };

  useEffect(() => {
    const controlled = new Set(["a", "d", "w", "s", "f", "l", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape", "p"]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (stageRef.current !== "fight") return;
      const key = normaliseKey(event.key);
      if (controlled.has(key)) event.preventDefault();
      if ((key === "Escape" || key === "p") && !event.repeat) {
        setBattle((current) => current && current.winner === null ? { ...current, paused: !current.paused } : current);
        keysRef.current.clear();
        return;
      }
      keysRef.current.add(key);
      if (event.repeat) return;
      if (key === controls[0].jump) tryJump(0);
      if (key === controls[1].jump) tryJump(1);
      if (key === controls[0].attack) performAttack(0);
      if (key === controls[1].attack) performAttack(1);
    };
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(normaliseKey(event.key));
    const clearKeys = () => {
      keysRef.current.clear();
      if (document.hidden) {
        setBattle((current) => current && current.winner === null ? { ...current, paused: true } : current);
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", clearKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", clearKeys);
    };
  }, []);

  const chooseHero = (hero: number) => {
    setProfiles((current) => {
      const next = current.map((profile, index) => index === activePicker ? { ...profile, hero } : profile) as [Profile, Profile];
      profilesRef.current = next;
      return next;
    });
    setActivePicker(activePicker === 0 ? 1 : 0);
  };

  const toggleMusic = () => {
    const engine = musicEngineRef.current ?? new GameMusicEngine();
    musicEngineRef.current = engine;
    if (musicEnabled && musicPlaying) {
      engine.stop();
      setMusicEnabled(false);
      setMusicPlaying(false);
      try { localStorage.setItem(musicPreferenceKey, "off"); } catch { /* Preference storage is optional. */ }
      return;
    }

    setMusicEnabled(true);
    try { localStorage.setItem(musicPreferenceKey, "on"); } catch { /* Preference storage is optional. */ }
    void engine.play(musicModeRef.current).then(setMusicPlaying);
  };

  const buyOrEquip = (weaponId: WeaponId, shopper: 0 | 1 = activeShopper) => {
    const result = buyOrEquipProfiles(profilesRef.current, shopper, weaponId);
    profilesRef.current = result.profiles;
    if (result.status === "purchased" && hydrated) {
      try {
        writeStoredProfiles(localStorage, profileStorageKey, result.profiles);
      } catch { /* The on-screen balance still updates when device storage is unavailable. */ }
    }
    setProfiles(result.profiles);
    setPurchaseReceipt({
      id: ++receiptIdRef.current,
      player: shopper,
      weapon: weaponId,
      status: result.status,
      beforeCoins: result.beforeCoins,
      afterCoins: result.afterCoins,
      spent: result.spent,
    });
  };

  const startBattle = () => {
    const roundId = ++roundIdRef.current;
    setRoundSettlement(null);
    setPurchaseReceipt(null);
    keysRef.current.clear();
    const ammo = (player: 0 | 1) => weapons[profilesRef.current[player].equipped].ammo;
    setBattle({
      id: roundId,
      fighters: [makeFighter(18, ammo(0)), makeFighter(82, ammo(1))],
      usedWeapons: [null, null],
      projectiles: [], explosions: [], countdown: 3000, timeLeft: 60,
      winner: null, reason: null, paused: false,
    });
    setStage("fight");
  };

  const resetProgress = () => {
    if (!window.confirm("确定要清空两位玩家的金币、胜场和已购武器吗？")) return;
    const resetProfiles = initialProfiles.map((profile) => ({ ...profile, owned: [...profile.owned] })) as [Profile, Profile];
    profilesRef.current = resetProfiles;
    setProfiles(resetProfiles);
    setPurchaseReceipt(null);
    setSaveRepairNotice(false);
    setStage("select");
  };

  const totalRounds = profiles[0].wins + profiles[1].wins;

  return (
    <main className={`game-shell stage-${stage}`}>
      <header className="topbar">
        <button
          className="brand-mark"
          onClick={() => setStage("select")}
          disabled={stage === "fight" && battle?.winner === null}
          aria-label={stage === "fight" && battle?.winner === null ? "对局中无法返回角色选择" : "返回角色选择"}
        >VS</button>
        <div className="brand-copy">
          <p className="eyebrow">双人同屏大乱斗</p>
          <h1>金币武器大战</h1>
        </div>
        <div className="header-actions">
          {stage !== "fight" && (
            <MusicButton
              enabled={musicEnabled}
              playing={musicPlaying}
              trackLabel={musicTracks[musicMode].label}
              onToggle={toggleMusic}
            />
          )}
          <div className="header-wallets" aria-label="玩家金币">
            <WalletBadge player={0} profile={profiles[0]} />
            <WalletBadge player={1} profile={profiles[1]} />
          </div>
        </div>
      </header>

      {stage !== "fight" && (
        <nav className="stepper" aria-label="游戏流程">
          <button className={stage === "select" ? "active" : "done"} onClick={() => setStage("select")}><b>1</b> 选人物</button>
          <span />
          <button className={stage === "armory" ? "active" : ""} onClick={() => setStage("armory")}><b>2</b> 武器库</button>
          <span />
          <button disabled><b>3</b> 开战</button>
        </nav>
      )}

      {stage === "select" && (
        <CharacterSelect
          profiles={profiles}
          activePicker={activePicker}
          setActivePicker={setActivePicker}
          chooseHero={chooseHero}
          onNext={() => setStage("armory")}
        />
      )}

      {stage === "armory" && (
        <Armory
          profiles={profiles}
          activeShopper={activeShopper}
          setActiveShopper={setActiveShopper}
          buyOrEquip={buyOrEquip}
          startBattle={startBattle}
          resetProgress={resetProgress}
          totalRounds={totalRounds}
          purchaseReceipt={purchaseReceipt}
          saveRepairNotice={saveRepairNotice}
          dismissSaveRepairNotice={() => setSaveRepairNotice(false)}
        />
      )}

      {stage === "fight" && battle && (
        <FightScene
          battle={battle}
          profiles={profiles}
          roundSettlement={roundSettlement}
          onAttack={performAttack}
          onJump={tryJump}
          keysRef={keysRef}
          onPause={() => {
            keysRef.current.clear();
            setBattle((current) => current && current.winner === null ? { ...current, paused: !current.paused } : current);
          }}
          onRematch={startBattle}
          onArmory={() => { keysRef.current.clear(); setBattle(null); setStage("armory"); }}
          onReselect={() => { keysRef.current.clear(); setBattle(null); setStage("select"); }}
          musicEnabled={musicEnabled}
          musicPlaying={musicPlaying}
          musicTrackLabel={musicTracks[musicMode].label}
          onToggleMusic={toggleMusic}
        />
      )}

      <footer className="game-footer">
        <p>原创符号化角色形象 · 原创本地像素配乐 · 游戏进度保存在当前设备</p>
      </footer>
    </main>
  );
}

function CharacterSelect({ profiles, activePicker, setActivePicker, chooseHero, onNext }: {
  profiles: [Profile, Profile]; activePicker: 0 | 1;
  setActivePicker: (player: 0 | 1) => void; chooseHero: (hero: number) => void; onNext: () => void;
}) {
  return (
    <section className="panel select-panel">
      <div className="section-heading">
        <span className="step-number">01</span>
        <div>
          <p className="kicker">CHOOSE YOUR HERO</p>
          <h2>两位玩家，选择你们的战士</h2>
          <p>所有人物能力相同，公平对决。选好之后去武器库看看吧！</p>
        </div>
      </div>

      <div className="picker-tabs" role="group" aria-label="选择要操作的玩家">
        {[0, 1].map((player) => {
          const index = player as 0 | 1;
          return (
            <button key={player} onClick={() => setActivePicker(index)} className={activePicker === player ? "active" : ""} aria-pressed={activePicker === player}>
              <span className={`tab-dot p${player + 1}`} />
              <b>玩家 {player + 1}</b>
              <small>{heroes[profiles[index].hero].name}</small>
            </button>
          );
        })}
      </div>

      <div className="selection-stage">
        <SelectedFighter player={0} profile={profiles[0]} active={activePicker === 0} onClick={() => setActivePicker(0)} />
        <div className="versus-burst">VS</div>
        <SelectedFighter player={1} profile={profiles[1]} active={activePicker === 1} onClick={() => setActivePicker(1)} />
      </div>

      <div className="roster-grid" aria-label={`为玩家 ${activePicker + 1} 选择角色`}>
        {heroes.map((hero, index) => {
          const pickedBy = profiles.map((profile) => profile.hero).includes(index);
          return (
            <button className={`hero-card ${profiles[activePicker].hero === index ? `picked-${activePicker + 1}` : ""}`} key={hero.name} onClick={() => chooseHero(index)} aria-pressed={profiles[activePicker].hero === index}>
              <HeroPortrait heroIndex={index} className={`mini-avatar ${hero.tone}`} />
              <span>{hero.name}</span>
              <small>{hero.motto}</small>
              {pickedBy && <i>{profiles[0].hero === index ? "P1" : "P2"}</i>}
            </button>
          );
        })}
      </div>

      <button className="primary-button" onClick={onNext}>
        <span>进入我的武器库</span><b>→</b>
      </button>
    </section>
  );
}

function SelectedFighter({ player, profile, active, onClick }: { player: 0 | 1; profile: Profile; active: boolean; onClick: () => void }) {
  const hero = heroes[profile.hero];
  return (
    <button className={`selected-fighter p${player + 1} ${active ? "active" : ""}`} onClick={onClick}>
      <span className="player-tag">玩家 {player + 1}</span>
      <HeroPortrait heroIndex={profile.hero} className={`big-avatar ${hero.tone}`} />
      <strong>{hero.name}</strong>
      <small>{hero.motto}</small>
    </button>
  );
}

function Armory({ profiles, activeShopper, setActiveShopper, buyOrEquip, startBattle, resetProgress, totalRounds, purchaseReceipt, saveRepairNotice, dismissSaveRepairNotice }: {
  profiles: [Profile, Profile]; activeShopper: 0 | 1; setActiveShopper: (player: 0 | 1) => void;
  buyOrEquip: (weapon: WeaponId, player?: 0 | 1) => void; startBattle: () => void; resetProgress: () => void; totalRounds: number;
  purchaseReceipt: PurchaseReceipt | null;
  saveRepairNotice: boolean; dismissSaveRepairNotice: () => void;
}) {
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | null>(null);
  const confirmPurchaseRef = useRef<HTMLButtonElement>(null);
  const confirmingPurchaseRef = useRef(false);
  const shopper = profiles[activeShopper];
  const receiptWeapon = purchaseReceipt ? weapons[purchaseReceipt.weapon] : null;
  const pendingWeapon = pendingPurchase ? weapons[pendingPurchase.weapon] : null;
  const pendingProfile = pendingPurchase ? profiles[pendingPurchase.player] : null;
  const pendingAfterCoins = pendingWeapon && pendingProfile ? Math.max(0, pendingProfile.coins - pendingWeapon.price) : 0;

  useEffect(() => {
    if (!pendingPurchase) return;
    confirmPurchaseRef.current?.focus();
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingPurchase(null);
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [pendingPurchase]);

  const handleWeaponAction = (weaponId: WeaponId) => {
    const weapon = weapons[weaponId];
    if (shopper.owned.includes(weaponId)) {
      buyOrEquip(weaponId, activeShopper);
      return;
    }
    if (shopper.coins >= weapon.price) {
      confirmingPurchaseRef.current = false;
      setPendingPurchase({ player: activeShopper, weapon: weaponId });
    }
  };

  const confirmPurchase = () => {
    if (!pendingPurchase || confirmingPurchaseRef.current) return;
    confirmingPurchaseRef.current = true;
    setActiveShopper(pendingPurchase.player);
    buyOrEquip(pendingPurchase.weapon, pendingPurchase.player);
    setPendingPurchase(null);
  };

  return (
    <section className="panel armory-panel">
      <div className="section-heading armory-heading">
        <span className="step-number">02</span>
        <div>
          <p className="kicker">VISIT THE ARMORY</p>
          <h2>选一件装备，然后上场开打</h2>
          <p>首次解锁会扣售价；每局真正使用付费武器后，胜者本局免单，输家或平局照扣。拳头始终免费。</p>
        </div>
        <div className="round-counter"><b>{totalRounds}</b><span>已完成对局</span></div>
      </div>

      {saveRepairNotice && (
        <div className="save-repair-note" role="status">
          <span aria-hidden="true">🔧</span>
          <div><b>旧存档的武器价格已修复</b><small>未实际扣够金币的付费武器已重新锁定；合法购买过的武器会继续保留。</small></div>
          <button onClick={dismissSaveRepairNotice} aria-label="关闭旧存档修复提示">知道了</button>
        </div>
      )}

      <div className="shopper-tabs" role="group" aria-label="选择购买武器的玩家">
        {[0, 1].map((player) => {
          const index = player as 0 | 1;
          const hero = heroes[profiles[index].hero];
          return (
            <button key={player} className={activeShopper === player ? "active" : ""} onClick={() => setActiveShopper(index)} aria-pressed={activeShopper === player}>
              <HeroPortrait heroIndex={profiles[index].hero} className={`shop-avatar ${hero.tone}`} />
              <span><small>玩家 {player + 1}</small><b>{hero.short}</b></span>
              <span className="shop-coins">◉ {profiles[index].coins}</span>
              <i>{activeShopper === player ? "正在选购" : "点击切换"}</i>
            </button>
          );
        })}
      </div>

      <div
        key={purchaseReceipt?.player === activeShopper ? `wallet-receipt-${purchaseReceipt.id}` : `wallet-${activeShopper}`}
        className={`wallet-strip ${purchaseReceipt?.player === activeShopper && purchaseReceipt.status === "purchased" ? "wallet-deducted" : ""}`}
      >
        <span>玩家 {activeShopper + 1} 的钱包</span>
        <strong>◉ {shopper.coins}</strong>
        <small>{shopper.coins < 0 ? "当前是负积分；获胜可得 200，且胜者武器使用费免单" : shopper.coins === 0 ? "拳头免费；付费武器使用后，赢免、输或平局照扣" : "解锁时扣款；每局胜者免使用费，输家或平局照扣"}</small>
        {purchaseReceipt?.player === activeShopper && purchaseReceipt.status === "purchased" && (
          <em key={`spent-${purchaseReceipt.id}`} className="coin-spend-pop">−◉ {purchaseReceipt.spent}</em>
        )}
      </div>

      {purchaseReceipt && receiptWeapon && (
        <div key={`receipt-${purchaseReceipt.id}`} className={`purchase-receipt receipt-${purchaseReceipt.status}`} role="status" aria-live="polite">
          <span aria-hidden="true">{purchaseReceipt.status === "purchased" ? "✓" : purchaseReceipt.status === "insufficient" ? "!" : "↻"}</span>
          <div>
            {purchaseReceipt.status === "purchased" ? (
              <>
                <strong>解锁扣款成功：玩家 {purchaseReceipt.player + 1} 买到{receiptWeapon.name}</strong>
                <small>◉ {purchaseReceipt.beforeCoins} − 解锁费 ◉ {purchaseReceipt.spent} = <b>◉ {purchaseReceipt.afterCoins}</b>；每局使用费 ◉ {receiptWeapon.price}，胜者免单，输家或平局照扣</small>
              </>
            ) : purchaseReceipt.status === "insufficient" ? (
              <>
                <strong>玩家 {purchaseReceipt.player + 1} 的金币不够</strong>
                <small>本次没有扣款，余额仍是 ◉ {purchaseReceipt.afterCoins}</small>
              </>
            ) : (
              <>
                <strong>{receiptWeapon.name}以前已经购买过</strong>
                <small>这次只是{purchaseReceipt.status === "already-equipped" ? "继续装备" : "切换装备"}，不扣解锁费；本局使用费 <b>◉ {receiptWeapon.price}</b>，胜者免单，输家或平局照扣</small>
              </>
            )}
          </div>
        </div>
      )}

      <div className="weapon-grid">
        {weaponOrder.map((weaponId) => {
          const weapon = weapons[weaponId];
          const owned = shopper.owned.includes(weaponId);
          const equipped = shopper.equipped === weaponId;
          const affordable = shopper.coins >= weapon.price;
          const shortfall = Math.max(0, weapon.price - shopper.coins);
          return (
            <article className={`weapon-card weapon-${weaponId} ${owned ? "owned" : "unowned"} ${!owned && !affordable ? "locked" : ""} ${equipped ? "equipped" : ""}`} key={weaponId}>
              <div className="weapon-icon" aria-hidden="true">{weapon.icon}</div>
              <div className="weapon-title">
                <span>{weaponId === "fist" ? "初始 · 永久免费" : owned ? "已解锁 · 赢免，输/平按使用收费" : "首次购买 · 永久解锁"}</span>
                <h3>{weapon.name}</h3>
              </div>
              <p>{weapon.detail}</p>
              <div className="damage-row"><span>伤害</span><b>{weapon.damage}</b><i style={{ width: `${Math.min(100, weapon.damage * 3)}%` }} /></div>
              <div className="price-row">
                <span>{weapon.price === 0 ? "解锁与使用都免费" : `解锁费 ◉ ${weapon.price} · 输/平使用费 ◉ ${weapon.price}`}</span>
                {weaponId !== "fist" && (
                  <small>{owned ? "装备不收费；实际出招后，赢免、输或平局扣一次" : affordable ? `当前余额 ◉ ${shopper.coins} · 获胜免本局使用费` : `余额 ◉ ${shopper.coins} · 解锁还差 ${shortfall}`}</small>
                )}
              </div>
              <button
                disabled={equipped || (!owned && !affordable)}
                onClick={() => handleWeaponAction(weaponId)}
                aria-label={`玩家 ${activeShopper + 1} · ${weapon.name} · ${weaponId === "fist" ? "拳头每局免费" : equipped ? `已装备，本局使用费 ${weapon.price} 积分，获胜免单，输掉或平局照扣` : owned ? `切换装备不收费，本局使用费 ${weapon.price} 积分，获胜免单，输掉或平局照扣` : affordable ? `打开解锁确认，立即扣除 ${weapon.price} 积分；每局胜者免使用费，输家或平局照扣` : `不能解锁，解锁费 ${weapon.price}，当前积分 ${shopper.coins}，还差 ${shortfall}`}`}
              >
                {weaponId === "fist" && equipped ? "✓ 拳头免费" : equipped ? `✓ 已装备 · 赢免 / 输平 −${weapon.price}` : owned ? `装备 · 赢免 / 输平 −${weapon.price}` : affordable ? `购买解锁 · 立即扣 ${weapon.price}` : `🔒 不能解锁 · 还差 ${shortfall}`}
              </button>
            </article>
          );
        })}
      </div>

      <div className="armory-actions">
        <button className="text-button" onClick={resetProgress}>重置游戏进度</button>
        <button className="primary-button battle-button" onClick={startBattle}><span>双方准备好了·开战！</span><b>⚔</b></button>
      </div>

      {pendingPurchase && pendingWeapon && pendingProfile && (
        <div className="purchase-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="purchase-confirm-title">
          <div className="purchase-confirm-card">
            <span className="purchase-confirm-kicker">确认扣款</span>
            <div className="purchase-confirm-icon" aria-hidden="true">{pendingWeapon.icon}</div>
            <h2 id="purchase-confirm-title">玩家 {pendingPurchase.player + 1} 购买{pendingWeapon.name}</h2>
            <p>确认后先扣一次解锁费，此费用不会退还；以后每局实际使用它，胜者免本局使用费，输家或平局结算 ◉ {pendingWeapon.price}。</p>
            <div className="purchase-math" aria-label={`购买前 ${pendingProfile.coins} 金币，扣除 ${pendingWeapon.price} 金币，购买后剩余 ${pendingAfterCoins} 金币`}>
              <span><small>购买前</small><b>◉ {pendingProfile.coins}</b></span>
              <i>−</i>
              <span><small>武器价格</small><b>◉ {pendingWeapon.price}</b></span>
              <i>=</i>
              <span className="after"><small>购买后</small><b>◉ {pendingAfterCoins}</b></span>
            </div>
            <div className="purchase-confirm-actions">
              <button onClick={() => setPendingPurchase(null)}>先不买</button>
              <button ref={confirmPurchaseRef} className="confirm" onClick={confirmPurchase}>确认支付 ◉ {pendingWeapon.price}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FightScene({ battle, profiles, roundSettlement, onAttack, onJump, keysRef, onPause, onRematch, onArmory, onReselect, musicEnabled, musicPlaying, musicTrackLabel, onToggleMusic }: {
  battle: BattleState; profiles: [Profile, Profile]; onAttack: (player: 0 | 1) => void; onJump: (player: 0 | 1) => void;
  roundSettlement: RoundSettlement | null;
  keysRef: React.MutableRefObject<Set<string>>; onPause: () => void; onRematch: () => void; onArmory: () => void; onReselect: () => void;
  musicEnabled: boolean; musicPlaying: boolean; musicTrackLabel: string; onToggleMusic: () => void;
}) {
  const facing = battle.fighters[0].x <= battle.fighters[1].x ? ["right", "left"] : ["left", "right"];
  const countdownLabel = battle.countdown > 0 ? Math.ceil(battle.countdown / 1000) : null;
  const resultFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (battle.winner !== null && roundSettlement?.battleId === battle.id) resultFocusRef.current?.focus();
  }, [battle.id, battle.winner, roundSettlement]);

  const hold = (key: string, pressed: boolean) => {
    if (pressed) keysRef.current.add(key);
    else keysRef.current.delete(key);
  };

  return (
    <section className="fight-screen" aria-label="双人格斗战场">
      <div className="fight-toolbar">
        <div className="fight-toolbar-actions">
          <button onClick={onPause} disabled={battle.winner !== null}>{battle.paused ? "继续游戏" : "暂停"} <kbd>P</kbd></button>
          <MusicButton enabled={musicEnabled} playing={musicPlaying} trackLabel={musicTrackLabel} onToggle={onToggleMusic} compact />
        </div>
        <div className="round-rule"><span>单局决胜</span><b>胜者 +200 · 武器使用费免单</b></div>
        <button onClick={onArmory} disabled={battle.winner === null || !roundSettlement}>返回武器库</button>
      </div>

      <div className="battle-hud">
        {[0, 1].map((player) => {
          const index = player as 0 | 1;
          const hero = heroes[profiles[index].hero];
          const weapon = weapons[profiles[index].equipped];
          const fighter = battle.fighters[index];
          return (
            <div className={`hud-player hud-p${player + 1}`} key={player}>
              <HeroPortrait heroIndex={profiles[index].hero} className={`hud-avatar ${hero.tone}`} />
              <div className="hud-data">
                <div><b>P{player + 1} · {hero.short}</b><span>{weapon.icon} {weapon.name}{weapon.ammo > 0 ? ` · ${Math.max(0, fighter.ammo)}` : ""}</span></div>
                <div className="health-track" role="progressbar" aria-label={`玩家 ${player + 1} 生命值`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.ceil(fighter.hp)}><i style={{ width: `${fighter.hp}%` }} /></div>
                <small>{Math.ceil(fighter.hp)} HP</small>
                <div className={`usage-fee-status ${battle.usedWeapons[index] ? "used" : ""}`} aria-live="polite">
                  {weapon.price === 0
                    ? "拳头免费"
                    : battle.usedWeapons[index]
                      ? `已使用 · 赢免 / 输平 −◉ ${weapon.price}`
                      : `尚未使用 · 当前不收费`}
                </div>
              </div>
            </div>
          );
        })}
        <div className="timer-badge"><small>TIME</small><b>{Math.ceil(battle.timeLeft)}</b></div>
      </div>

      <div className="arena">
        <div className="arena-sun" />
        <div className="cloud cloud-one" />
        <div className="cloud cloud-two" />
        <div className="city city-back" />
        <div className="city city-front" />
        <div className="arena-sign">COIN<br />BATTLE</div>
        <div className="ground-line" />

        {battle.projectiles.map((projectile) => (
          <span
            key={projectile.id}
            className={`projectile ${projectile.type} owner-${projectile.owner + 1}`}
            style={{ left: `${projectile.x}%`, bottom: `calc(15% + ${projectile.y}px)` }}
          >{projectile.type === "grenade" ? "✹" : ""}</span>
        ))}

        {battle.explosions.map((explosion) => (
          <span key={explosion.id} className="explosion" style={{ left: `${explosion.x}%`, bottom: "15%" }}>★</span>
        ))}

        {[0, 1].map((player) => {
          const index = player as 0 | 1;
          const fighter = battle.fighters[index];
          const hero = heroes[profiles[index].hero];
          const weapon = weapons[profiles[index].equipped];
          return (
            <div
              className={`arena-fighter p${player + 1} face-${facing[player]} ${fighter.crouch ? "crouching" : ""} ${fighter.attackingUntil > 0 ? "attacking" : ""} ${fighter.hitUntil > 0 ? "hit" : ""}`}
              style={{ left: `${fighter.x}%`, bottom: `calc(15% + ${fighter.y}px)` }}
              key={player}
            >
              <span className="fighter-name">P{player + 1} · {hero.short}</span>
              <div className={`fighter-figure ${hero.tone}`}>
                <HeroPortrait heroIndex={profiles[index].hero} className="fighter-symbol" />
                <span className={`held-weapon held-${profiles[index].equipped}`} aria-label={weapon.name}>{weapon.icon}</span>
              </div>
              <span className="fighter-shadow" />
            </div>
          );
        })}

        {countdownLabel && <div className="countdown" aria-live="polite"><small>READY?</small><b>{countdownLabel}</b></div>}
        {!countdownLabel && battle.timeLeft > 59.5 && <div className="fight-call">FIGHT!</div>}
        {battle.paused && <div className="pause-card"><b>已暂停</b><span>按 P 或点击按钮继续</span></div>}

        {battle.winner !== null && (
          <div className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="battle-result-title">
            <div className="result-card">
              <span className="result-kicker">{battle.reason === "TIME" ? "TIME UP" : "K.O."}</span>
              {battle.winner === "draw" ? (
                <><h2 id="battle-result-title">平局！</h2><p>平局不发胜利奖励；使用过的付费武器仍然照常扣费。</p></>
              ) : (
                <>
                  <HeroPortrait heroIndex={profiles[battle.winner].hero} className={`result-avatar ${heroes[profiles[battle.winner].hero].tone}`} />
                  <h2 id="battle-result-title">玩家 {battle.winner + 1} 胜利！</h2>
                  <p>{heroes[profiles[battle.winner].hero].name} 获得 <b>+200 ◉</b>，本局武器使用费全部免单！</p>
                </>
              )}
              {roundSettlement?.battleId === battle.id ? (
                <div className="round-ledger" aria-label="本局积分结算">
                  {roundSettlement.entries.map((entry, player) => {
                    const usedWeapon = weapons[entry.weapon];
                    return (
                      <section className={`ledger-player p${player + 1}`} key={player}>
                        <div><b>玩家 {player + 1}</b><span>{entry.listedFee > 0 ? `${usedWeapon.name}已使用` : "未使用付费武器"}</span></div>
                        <dl>
                          <div><dt>原积分</dt><dd>◉ {entry.beforeCoins}</dd></div>
                          <div><dt>胜利奖励</dt><dd className={entry.reward > 0 ? "reward" : ""}>+◉ {entry.reward}</dd></div>
                          <div>
                            <dt>武器使用费</dt>
                            <dd className={entry.waivedFee > 0 ? "waived" : entry.fee > 0 ? "fee" : ""}>
                              {entry.waivedFee > 0 ? `胜者免单（原 ◉ ${entry.listedFee}）` : entry.listedFee === 0 ? "无需收费" : `−◉ ${entry.fee}`}
                            </dd>
                          </div>
                          <div className="ledger-total"><dt>结算后</dt><dd className={entry.afterCoins < 0 ? "negative" : ""}>◉ {entry.afterCoins}</dd></div>
                        </dl>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="settling-note" role="status">正在结算胜利奖励与武器使用费…</div>
              )}
              <div className="result-actions">
                <button ref={resultFocusRef} onClick={onRematch} disabled={!roundSettlement}>直接再战</button>
                <button className="accent" onClick={onArmory} disabled={!roundSettlement}>去武器库调整装备</button>
                <button onClick={onReselect} disabled={!roundSettlement}>重新选人</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="control-legend">
        <div><b>P1</b><span><kbd>A</kbd><kbd>D</kbd> 前后</span><span><kbd>W</kbd> 跳</span><span><kbd>S</kbd> 蹲</span><span><kbd>F</kbd> 攻击</span></div>
        <div><b>P2</b><span><kbd>←</kbd><kbd>→</kbd> 前后</span><span><kbd>↑</kbd> 跳</span><span><kbd>↓</kbd> 蹲</span><span><kbd>L</kbd> 攻击</span></div>
      </div>

      <div className="touch-controls" aria-label="触屏操作区">
        <TouchPad player={0} onHold={hold} onJump={onJump} onAttack={onAttack} />
        <TouchPad player={1} onHold={hold} onJump={onJump} onAttack={onAttack} />
      </div>
    </section>
  );
}

function TouchPad({ player, onHold, onJump, onAttack }: { player: 0 | 1; onHold: (key: string, pressed: boolean) => void; onJump: (player: 0 | 1) => void; onAttack: (player: 0 | 1) => void }) {
  const map = controls[player];
  const holdProps = (key: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onHold(key, true); },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); onHold(key, false); },
    onPointerCancel: () => onHold(key, false),
    onLostPointerCapture: () => onHold(key, false),
  });
  return (
    <div className={`touch-pad p${player + 1}`}>
      <b>P{player + 1}</b>
      <div className="touch-directions">
        <button aria-label={`玩家${player + 1}向左`} {...holdProps(map.left)}>←</button>
        <button aria-label={`玩家${player + 1}跳跃`} onPointerDown={(event) => { event.preventDefault(); onJump(player); }}>↑</button>
        <button aria-label={`玩家${player + 1}蹲下`} {...holdProps(map.crouch)}>↓</button>
        <button aria-label={`玩家${player + 1}向右`} {...holdProps(map.right)}>→</button>
      </div>
      <button className="touch-attack" aria-label={`玩家${player + 1}攻击`} onPointerDown={(event) => { event.preventDefault(); onAttack(player); }}>攻</button>
    </div>
  );
}

function WalletBadge({ player, profile }: { player: 0 | 1; profile: Profile }) {
  return (
    <div className={`wallet-badge p${player + 1}`}>
      <span>P{player + 1}</span><b>◉ {profile.coins}</b><small>{profile.wins} 胜</small>
    </div>
  );
}

function MusicButton({ enabled, playing, trackLabel, onToggle, compact = false }: {
  enabled: boolean; playing: boolean; trackLabel: string; onToggle: () => void; compact?: boolean;
}) {
  const label = playing ? compact ? "配乐开" : "配乐：开" : enabled ? "播放配乐" : "开启配乐";
  return (
    <button
      type="button"
      className={`music-button ${playing ? "is-playing" : ""} ${compact ? "compact" : ""}`}
      onClick={onToggle}
      aria-pressed={playing}
      aria-label={playing ? `关闭游戏配乐，正在播放${trackLabel}` : `开启游戏配乐：${trackLabel}`}
      title={playing ? `正在播放：${trackLabel}` : `播放：${trackLabel}`}
    >
      <span className="music-bars" aria-hidden="true"><i /><i /><i /></span>
      <b>{label}</b>
    </button>
  );
}

function HeroPortrait({ heroIndex, className }: { heroIndex: number; className: string }) {
  const column = heroIndex % 4;
  const row = Math.floor(heroIndex / 4);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return (
    <span
      className={`funny-portrait ${className}`}
      style={{
        backgroundImage: `url("${basePath}/funny-fighters-v1.png")`,
        backgroundPosition: `${column * 100 / 3}% ${row * 100}%`,
      }}
      aria-hidden="true"
    />
  );
}

function makeFighter(x: number, ammo: number): FighterState {
  return { x, y: 0, vy: 0, hp: 100, crouch: false, ammo, cooldownUntil: 0, attackingUntil: 0, hitUntil: 0 };
}

function updateBattle(current: BattleState, keys: Set<string>, dt: number): BattleState {
  if (current.winner !== null || current.paused) return current;
  const next = cloneBattle(current);
  if (next.countdown > 0) {
    next.countdown = Math.max(0, next.countdown - dt * 1000);
    return next;
  }

  next.timeLeft = Math.max(0, next.timeLeft - dt);
  const now = Date.now();

  next.fighters.forEach((fighter, index) => {
    const map = controls[index];
    const left = keys.has(map.left);
    const right = keys.has(map.right);
    fighter.crouch = keys.has(map.crouch) && fighter.y <= 0.5;
    const direction = (right ? 1 : 0) - (left ? 1 : 0);
    const speed = fighter.crouch ? 10 : 26;
    fighter.x = clamp(fighter.x + direction * speed * dt, 4, 96);
    fighter.y += fighter.vy * dt;
    fighter.vy -= 800 * dt;
    if (fighter.y <= 0) { fighter.y = 0; fighter.vy = 0; }
    if (fighter.attackingUntil <= now) fighter.attackingUntil = 0;
    if (fighter.hitUntil <= now) fighter.hitUntil = 0;
  });

  const [first, second] = next.fighters;
  if (Math.abs(first.x - second.x) < 5 && first.y < 32 && second.y < 32) {
    const middle = (first.x + second.x) / 2;
    if (first.x <= second.x) { first.x = middle - 2.5; second.x = middle + 2.5; }
    else { first.x = middle + 2.5; second.x = middle - 2.5; }
  }

  const liveProjectiles: Projectile[] = [];
  const pendingDamage: [{ damage: number; knockback: number }, { damage: number; knockback: number }] = [
    { damage: 0, knockback: 0 },
    { damage: 0, knockback: 0 },
  ];
  next.projectiles.forEach((projectile) => {
    const shot = { ...projectile, age: projectile.age + dt, x: projectile.x + projectile.vx * dt, y: projectile.y + projectile.vy * dt };
    if (shot.type === "grenade") {
      shot.vy -= 120 * dt;
      if (shot.y < 2) { shot.y = 2; shot.vy = Math.abs(shot.vy) * 0.28; shot.vx *= 0.7; }
      if (shot.age >= 1.25) {
        next.explosions.push({ id: shot.id, x: shot.x, life: 0.48 });
        next.fighters.forEach((fighter, index) => {
          const distance = Math.abs(fighter.x - shot.x);
          if (distance <= weapons.grenade.range && fighter.y < 42) {
            const damage = index === shot.owner ? 12 : Math.round(weapons.grenade.damage * (1 - distance / 28));
            pendingDamage[index].damage += Math.max(10, damage);
            pendingDamage[index].knockback += fighter.x >= shot.x ? 6 : -6;
          }
        });
        return;
      }
      liveProjectiles.push(shot);
      return;
    }

    const targetIndex = (shot.owner === 0 ? 1 : 0) as 0 | 1;
    const target = next.fighters[targetIndex];
    const bodyHeight = target.crouch ? 30 : 58;
    const hitsHeight = shot.y >= target.y + 4 && shot.y <= target.y + bodyHeight;
    if (Math.abs(shot.x - target.x) < 3.6 && hitsHeight) {
      pendingDamage[targetIndex].damage += weapons.pistol.damage;
      pendingDamage[targetIndex].knockback += shot.vx > 0 ? 3 : -3;
      return;
    }
    if (shot.x > -5 && shot.x < 105 && shot.age < 2) liveProjectiles.push(shot);
  });
  next.projectiles = liveProjectiles;
  pendingDamage.forEach((hit, index) => {
    if (hit.damage > 0) damageFighter(next, index as 0 | 1, hit.damage, clamp(hit.knockback, -8, 8), now);
  });
  next.explosions = next.explosions.map((effect) => ({ ...effect, life: effect.life - dt })).filter((effect) => effect.life > 0);

  if (next.timeLeft <= 0) {
    next.reason = "TIME";
    next.winner = first.hp === second.hp ? "draw" : first.hp > second.hp ? 0 : 1;
  }
  return resolveKnockout(next);
}

function damageFighter(battle: BattleState, index: 0 | 1, damage: number, knockback: number, now: number) {
  const fighter = battle.fighters[index];
  if (fighter.hitUntil > now || battle.winner !== null) return;
  fighter.hp = Math.max(0, fighter.hp - damage);
  fighter.x = clamp(fighter.x + knockback, 4, 96);
  fighter.hitUntil = now + 220;
}

function resolveKnockout(battle: BattleState): BattleState {
  const [first, second] = battle.fighters;
  if (first.hp > 0 && second.hp > 0) return battle;
  battle.reason = "KO";
  battle.winner = first.hp <= 0 && second.hp <= 0 ? "draw" : first.hp <= 0 ? 1 : 0;
  return battle;
}

function cloneBattle(battle: BattleState): BattleState {
  return {
    ...battle,
    fighters: battle.fighters.map((fighter) => ({ ...fighter })) as [FighterState, FighterState],
    usedWeapons: [...battle.usedWeapons] as [WeaponId | null, WeaponId | null],
    projectiles: battle.projectiles.map((projectile) => ({ ...projectile })),
    explosions: battle.explosions.map((effect) => ({ ...effect })),
  };
}

function sanitiseProfiles(value: unknown): { profiles: [Profile, Profile]; repaired: boolean } {
  if (!Array.isArray(value) || value.length !== 2) return { profiles: initialProfiles, repaired: true };
  let repaired = false;
  const profiles = value.map((candidate, index) => {
    const profile = (candidate && typeof candidate === "object" ? candidate : {}) as Partial<Profile>;
    const owned = Array.isArray(profile.owned) ? profile.owned.filter((id): id is WeaponId => weaponOrder.includes(id as WeaponId)) : ["fist" as WeaponId];
    if (!owned.includes("fist")) owned.unshift("fist");
    const equipped = profile.equipped && owned.includes(profile.equipped) ? profile.equipped : "fist";
    const normalised: Profile = {
      hero: Number.isInteger(profile.hero) ? clamp(Number(profile.hero), 0, heroes.length - 1) : initialProfiles[index].hero,
      coins: Math.floor(Number(profile.coins) || 0),
      wins: Math.max(0, Math.floor(Number(profile.wins) || 0)),
      owned,
      equipped,
    };
    const reconciled = reconcileProfilePurchases(normalised);
    if (reconciled.repaired) repaired = true;
    return reconciled.profile;
  }) as [Profile, Profile];
  return { profiles, repaired };
}

function normaliseKey(key: string) { return key.length === 1 ? key.toLowerCase() : key; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
