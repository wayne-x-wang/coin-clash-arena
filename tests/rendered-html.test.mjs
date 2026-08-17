import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Chinese two-player battle game", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]+lang="zh-CN"/i);
  assert.match(html, /<title>金币武器大战 \| 双人同屏格斗<\/title>/i);
  assert.match(html, /金币武器大战/);
  assert.match(html, /两位玩家，选择你们的战士/);

  for (const character of ["艾莎公主", "白雪公主", "量子战队", "机械恐龙", "安娜公主", "超级玛丽欧", "奥特曼", "灰色机械怪兽"]) {
    assert.match(html, new RegExp(character));
  }

  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton|Starter Project/);
});

test("does not expose the Cloudflare image transformation route", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-no-image-transform`);
  const { default: worker } = await import(workerUrl.href);
  let assetFetches = 0;

  const response = await worker.fetch(
    new Request(
      "http://localhost/_vinext/image?url=%2Ffunny-fighters-v1.png&w=640&q=75&dpl=attacker-nonce",
    ),
    {
      ASSETS: {
        fetch: async () => {
          assetFetches += 1;
          return new Response("Not found", { status: 404 });
        },
      },
      get IMAGES() {
        throw new Error("Cloudflare Images must not be accessed");
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/funny-fighters-v1.png");
  assert.equal(assetFetches, 0);
});

test("keeps the economy, gameplay, original music, and funny character art in the finished source", async () => {
  const [page, economy, audio, css, layout, packageJson, viteConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/economy.js", import.meta.url), "utf8"),
    readFile(new URL("../app/game-audio.js", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(economy, /stick:\s*100/);
  assert.match(economy, /nunchaku:\s*300/);
  assert.match(economy, /grenade:\s*500/);
  assert.match(economy, /pistol:\s*500/);
  assert.match(page, /stick:\s*\{[^}]*price:\s*weaponPrices\.stick[^}]*damage:\s*14/s);
  assert.match(page, /pistol:\s*\{[^}]*price:\s*weaponPrices\.pistol[^}]*damage:\s*11/s);
  assert.match(economy, /function settleRoundOnce/);
  assert.match(economy, /const waivedFee\s*=\s*winnerIndex\s*===\s*player\s*\?\s*listedFee\s*:\s*0/);
  assert.match(economy, /const fee\s*=\s*listedFee\s*-\s*waivedFee/);
  assert.match(economy, /afterCoins\s*=\s*beforeCoins\s*\+\s*roundReward\s*-\s*fee/);
  assert.match(page, /buyOrEquipProfiles/);
  assert.match(page, /settleRoundOnce/);
  assert.match(page, /next\.usedWeapons\[player\]\s*===\s*null/);
  assert.match(page, /已使用 · 赢免/);
  assert.match(page, /武器使用费/);
  assert.match(page, /胜者免单/);
  assert.match(page, /本局武器使用费全部免单/);
  assert.match(page, /平局不发胜利奖励；使用过的付费武器仍然照常扣费/);
  assert.match(page, /coins:\s*Math\.floor/);
  assert.match(page, /扣款成功/);
  assert.match(page, /确认支付/);
  assert.match(page, /purchase-math/);
  assert.match(page, /coin-spend-pop/);
  assert.match(page, /writeStoredProfiles\(localStorage, profileStorageKey, result\.profiles\)/);
  assert.match(page, /不能解锁/);
  assert.match(page, /owned:\s*\["fist"\],\s*equipped:\s*"fist"/);
  assert.match(page, /coin-battle-profiles-v1/);
  assert.match(page, /addEventListener\("keydown"/);
  assert.match(page, /className="touch-controls"/);
  assert.match(page, /function HeroPortrait/);
  assert.match(page, /冰箱门忘关了/);
  assert.match(page, /开启配乐/);
  assert.match(page, /aria-pressed=\{playing\}/);
  assert.match(audio, /class GameMusicEngine/);
  assert.match(audio, /select: makeTrack/);
  assert.match(audio, /armory: makeTrack/);
  assert.match(audio, /fight: makeTrack/);
  assert.match(audio, /victory: makeTrack/);
  assert.doesNotMatch(audio, /https?:\/\//);
  assert.match(page, /funny-fighters-v1\.png/);
  assert.match(page, /NEXT_PUBLIC_BASE_PATH/);
  assert.match(css, /@keyframes portrait-wobble/);
  assert.match(css, /@keyframes coin-spend-fly/);
  assert.match(css, /\.purchase-confirm-overlay/);
  assert.match(css, /@keyframes music-bar/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /@openai\/sites-vite-plugin/);
  assert.doesNotMatch(viteConfig, /sites-vite-plugin|sites\(\)|hosting\.json/);
  await access(new URL("../public/funny-fighters-v1.png", import.meta.url));
});
