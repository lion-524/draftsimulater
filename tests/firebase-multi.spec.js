import { test, expect } from "@playwright/test";

test("roster modes create the expected candidate pools", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#draftModeSelect option")).toHaveCount(6);

  const pools = await page.evaluate(() => {
    const modeMappings = [...document.querySelectorAll("#draftModeSelect option")].map(option => {
      applyDraftMode(option.value);
      return `${draftSystem}:${draftRosterMode}`;
    });
    draftRosterMode = "all_current";
    const currentCount = buildSessionPool(1).length;
    const currentMembersOnly = buildSessionPool(1).every(member => member.在籍状況 === "現役");

    draftRosterMode = "all_registered";
    const registeredCount = buildSessionPool(1).length;

    draftRosterMode = "group_current";
    const currentByGroup = [1, 2, 3].map(session => buildSessionPool(session).length);

    draftRosterMode = "group_registered";
    const registeredByGroup = [1, 2, 3].map(session => buildSessionPool(session).length);

    draftRosterMode = "classic";
    return {
      currentCount,
      modeMappings,
      currentMembersOnly,
      registeredCount,
      currentByGroup,
      registeredByGroup,
      classicFirstSessionCount: buildSessionPool(1).length,
      sessionCounts: ["classic", "all_current", "all_registered", "group_current", "group_registered"].map(mode => {
        draftRosterMode = mode;
        return getDraftSessionCount();
      })
    };
  });

  expect(pools.currentCount).toBe(89);
  expect(pools.modeMappings).toEqual([
    "waiver:classic",
    "all_lottery:classic",
    "waiver:all_current",
    "waiver:all_registered",
    "waiver:group_current",
    "waiver:group_registered"
  ]);
  expect(pools.currentMembersOnly).toBe(true);
  expect(pools.registeredCount).toBe(204);
  expect(pools.currentByGroup).toEqual([33, 30, 26]);
  expect(pools.registeredByGroup.reduce((sum, count) => sum + count, 0)).toBe(204);
  expect(pools.classicFirstSessionCount).toBeGreaterThan(0);
  expect(pools.sessionCounts).toEqual([7, 1, 1, 3, 3]);
});

test("host and guest keep lottery results in their pick history", async ({ browser, baseURL }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.emulateMedia({ reducedMotion: "reduce" });
  await guest.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  host.on("dialog", dialog => dialog.accept("E2E Host"));
  guest.on("dialog", dialog => dialog.accept("E2E Guest"));
  host.on("pageerror", error => errors.push(`host: ${error.message}`));
  guest.on("pageerror", error => errors.push(`guest: ${error.message}`));
  host.on("console", message => {
    if (message.type() === "error") errors.push(`host console: ${message.text()}`);
  });
  host.on("requestfailed", request => errors.push(`host request: ${request.url()} ${request.failure()?.errorText}`));

  await host.goto(`${baseURL}/?emulator=1`);
  await host.getByRole("button", { name: /オンライン対戦/ }).click();
  await host.locator("#inputRoomId").fill("e2e123");
  await host.getByRole("button", { name: "部屋を作成 / 参加" }).click();
  await expect(host.locator("#roomWaitArea")).toBeVisible({ timeout: 5000 }).catch(async error => {
    console.log("Host room log:", await host.locator("#logTerminal").innerText());
    console.log("Browser errors:", errors);
    throw error;
  });

  await guest.goto(`${baseURL}/?emulator=1`);
  await guest.getByRole("button", { name: /オンライン対戦/ }).click();
  await guest.locator("#inputRoomId").fill("e2e123");
  await guest.getByRole("button", { name: "部屋を作成 / 参加" }).click();
  await expect(guest.locator("#roomWaitArea")).toBeVisible();

  await guest.locator(".lobby-rank-control select").selectOption("8");
  await expect.poll(() => host.evaluate(() => teams.map(team => team.rank))).toEqual([7, 8, 6, 5, 4, 3, 2, 1]);
  await expect.poll(() => guest.evaluate(() => teams.map(team => team.rank))).toEqual([7, 8, 6, 5, 4, 3, 2, 1]);

  await host.locator("#multiStartBtn").click();
  await expect(host.locator("#playerDropdown option").first()).toBeAttached();
  await expect(guest.locator("#playerDropdown option").first()).toBeAttached();
  await expect(host.locator("#loading")).toBeHidden();
  await expect(guest.locator("#loading")).toBeHidden();
  expect(await host.evaluate(() => allMasterData[0].名前)).toBe("岩瀬 佑美子");
  expect(await host.evaluate(() => allMasterData[0].ポイント)).toBe(505);

  const expectedRanks = [1, 8, 2, 3, 4, 5, 6, 7];
  await host.evaluate(() => {
    teams.forEach(team => {
      team.sessionPicks = [{ 名前: "順位同期テスト", ポイント: team.id === 1 ? 0 : (9 - team.id) * 1000 }];
    });
    determineNextSessionRanks();
  });
  await expect.poll(() => guest.evaluate(() => teams.map(team => team.rank))).toEqual(expectedRanks);
  await expect.poll(() => host.evaluate(() => teams.map(team => team.rank))).toEqual(expectedRanks);
  await host.evaluate(() => nextSession());
  await expect(host.locator("#currentSessionLabel")).toContainText("第 2 周目");
  await expect(guest.locator("#currentSessionLabel")).toContainText("第 2 周目");
  await expect.poll(() => guest.evaluate(() => teams.map(team => team.rank))).toEqual(expectedRanks).catch(async error => {
    console.log("Expected ranks:", expectedRanks);
    console.log("Host ranks:", await host.evaluate(() => teams.map(team => team.rank)));
    console.log("Guest ranks:", await guest.evaluate(() => teams.map(team => team.rank)));
    console.log("Start event:", await host.evaluate(async () => (await db.ref("rooms/e2e123/roundEvent").once("value")).val()));
    throw error;
  });

  for (const page of [host, guest]) {
    await page.evaluate(() => {
      teams[0].sessionPicks = [{ 名前: "前巡テスト指名", draftRound: 1, 出身: "高卒", 所属: "" }];
      updateRoundBoardVisualizer(2);
    });
    await expect(page.locator("#roundBoardGrid")).not.toContainText("前巡テスト指名");
  }

  const sharedName = await host.locator("#playerDropdown option").nth(1).getAttribute("value");
  expect(sharedName).toBeTruthy();
  await host.locator("#playerDropdown").selectOption(sharedName);
  await guest.locator("#playerDropdown").selectOption(sharedName);
  await host.locator("#nominateBtn").click();
  await guest.locator("#nominateBtn").click();

  for (let step = 1; step <= 8; step++) {
    await host.waitForTimeout(450);
    await expect(host.locator("#draftRevealModal")).toBeVisible();
    await expect(host.locator("#draftRevealModal")).toHaveAttribute("data-step", String(step));
    await expect(guest.locator("#draftRevealModal")).toBeVisible();
    await expect(guest.locator("#draftRevealModal")).toHaveAttribute("data-step", String(step));
    await host.keyboard.press("Enter");
    await expect(host.locator("#draftRevealGuide")).toContainText("次の球団へ");
    await expect(guest.locator("#draftRevealGuide")).toContainText("次の球団へ");
    await expect(host.locator("#draftRevealModal")).toHaveAttribute("data-step", String(step));
    await host.waitForTimeout(450);
    await host.keyboard.press("Enter");
    if (step < 8) {
      await expect(host.locator("#draftRevealModal")).toHaveAttribute("data-step", String(step + 1));
    }
  }

  await expect(host.locator("#lotteryModal")).toBeVisible();
  await expect(guest.locator("#lotteryModal")).toBeVisible();
  await expect(host.locator("#lotteryDetails")).toContainText("第1引: E2E Guest");
  await expect(guest.locator("#lotteryDetails")).toContainText("第1引: E2E Guest");
  await expect.poll(() => guest.locator(".envelope.selectable").count()).toBeGreaterThan(0);
  await expect(host.locator(".envelope.selectable")).toHaveCount(0);
  await guest.locator(".envelope.selectable").first().click({ force: true });
  await expect(guest.locator(".envelope.selectable")).toHaveCount(0);
  await expect.poll(() => host.locator(".envelope.selectable").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await host.locator(".envelope.selectable").first().click({ force: true });

  await expect(host.locator("#lotteryResultStamp")).toContainText("交渉権獲得");
  await expect(guest.locator("#lotteryResultStamp")).toContainText("交渉権獲得");
  await expect(host.locator("#teamsContainer")).toContainText(sharedName);
  await expect(guest.locator("#teamsContainer")).toContainText(sharedName);
  const sharedOwnerSlots = await host.evaluate(name => teams.filter(team =>
    team.allPicks.some(pick => !pick.isPass && pick.名前 === name)
  ).map(team => team.id), sharedName);
  const guestSharedOwnerSlots = await guest.evaluate(name => teams.filter(team =>
    team.allPicks.some(pick => !pick.isPass && pick.名前 === name)
  ).map(team => team.id), sharedName);
  expect(sharedOwnerSlots).toHaveLength(1);
  expect(guestSharedOwnerSlots).toEqual(sharedOwnerSlots);

  const hostWon = (await host.locator("#lotteryResultStamp").innerText()).includes("E2E Host");
  const loserPage = hostWon ? guest : host;
  await expect(loserPage.locator("#actionControls")).toBeVisible({ timeout: 60_000 });

  const nextName = await loserPage.locator("#playerDropdown option").evaluateAll((options, pickedName) =>
    options.map(option => option.value).find(value => value && value !== pickedName), sharedName
  );
  expect(nextName).toBeTruthy();
  await host.evaluate(() => {
    window._testRevealEnter = setInterval(() => {
      const modal = document.getElementById("draftRevealModal");
      if (modal?.style.display === "flex") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
    }, 250);
  });
  await loserPage.locator("#playerDropdown").selectOption(nextName);
  await loserPage.locator("#nominateBtn").click();

  await expect(host.locator("#teamsContainer")).toContainText(nextName);
  await expect(guest.locator("#teamsContainer")).toContainText(nextName);
  await expect(host.locator("#teamsContainer")).toContainText(sharedName);
  await expect(guest.locator("#teamsContainer")).toContainText(sharedName);
  const hostOwnersAfterRePick = await host.evaluate(name => teams.filter(team =>
    team.allPicks.some(pick => !pick.isPass && pick.名前 === name)
  ).map(team => team.id), nextName);
  const guestOwnersAfterRePick = await guest.evaluate(name => teams.filter(team =>
    team.allPicks.some(pick => !pick.isPass && pick.名前 === name)
  ).map(team => team.id), nextName);
  expect(hostOwnersAfterRePick).toHaveLength(1);
  expect(guestOwnersAfterRePick).toEqual(hostOwnersAfterRePick);

  const duplicateOwners = await host.evaluate(() => {
    const ownersByPick = new Map();
    teams.forEach(team => team.allPicks.filter(pick => !pick.isPass).forEach(pick => {
      const key = `${pick.session}:${pick.名前}`;
      const owners = ownersByPick.get(key) || [];
      owners.push(team.id);
      ownersByPick.set(key, owners);
    }));
    return [...ownersByPick].filter(([, owners]) => new Set(owners).size > 1);
  });
  expect(duplicateOwners).toEqual([]);
  expect(errors).toEqual([]);
  await host.evaluate(() => clearInterval(window._testRevealEnter));

  await expect(host.locator("#readyNextRoundBtn")).toBeVisible({ timeout: 60_000 });
  await expect(guest.locator("#readyNextRoundBtn")).toBeVisible();
  await host.locator("#readyNextRoundBtn").click();
  await guest.locator("#readyNextRoundBtn").click();
  await expect(guest.locator("#actionControls")).toBeVisible();

  const waiverName = await guest.locator("#playerDropdown option").evaluateAll(options =>
    options.find(option => option.value)?.value
  );
  expect(waiverName).toBeTruthy();
  await guest.locator("#playerDropdown").selectOption(waiverName);
  await guest.locator("#nominateBtn").click();
  await expect(host.locator("#draftRevealModal")).toBeVisible();
  await expect(host.locator("#draftRevealTitle")).toContainText("E2E Guest");
  await host.waitForTimeout(450);
  await host.keyboard.press("Enter");
  await expect(host.locator("#draftRevealGuide")).toContainText("次の球団へ");
  await host.waitForTimeout(450);
  await host.keyboard.press("Enter");
  await expect(host.locator("#draftRevealModal")).toBeHidden();

  await host.keyboard.press("Enter");
  await expect(host.locator("#draftRevealModal")).toBeHidden();
  await expect(host.locator("#draftRevealModal")).toBeVisible({ timeout: 10_000 });
  await expect(host.locator("#draftRevealTitle")).toContainText("CPU");

  await host.close();
  await guest.close();
});

test("soccer and baseball formations show player photos and sync defensive picks", async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`);
  await expect(page.locator("#loading")).toBeHidden();
  const [firstMember, secondMember] = await page.evaluate(() => {
    document.getElementById("formationSection").style.display = "block";
    initTeams();
    teams[myPlayerSlot].allPicks = [allMasterData[0], allMasterData[1]];
    return allMasterData.slice(0, 2).map(member => ({ name: member.名前, photo: member.写真 }));
  });

  await page.evaluate(() => window.switchSportTab("idol"));
  const idolSelect = page.locator(".idol-select").first();
  await idolSelect.selectOption(firstMember.name);
  await expect(page.locator("#slot-row1-1 .member-avatar img")).toHaveAttribute("src", firstMember.photo);
  await expect(page.locator("#slot-row1-1 .member-avatar")).toHaveCSS("border-radius", "4px");

  await page.evaluate(() => window.switchSportTab("soccer"));
  const soccerSelect = page.locator(".soccer-player-slot .sport-player-select").first();
  await soccerSelect.click();
  await soccerSelect.selectOption(firstMember.name);
  await expect(page.locator(".soccer-player-slot .sport-player-name").first()).toHaveText(firstMember.name);
  await expect(page.locator(".soccer-player-slot .sport-player-image").first()).toHaveAttribute("src", firstMember.photo);
  await expect(page.locator(".soccer-player-slot .sport-player-image").first()).toHaveCSS("border-radius", "4px");

  await page.evaluate(() => {
    document.getElementById("dhCheck").checked = false;
    window.switchSportTab("baseball");
  });
  const battingSelect = page.locator('.baseball-lineup-row[data-order="1"] .baseball-lineup-player-select');
  await battingSelect.click();
  await battingSelect.selectOption(secondMember.name);
  await page.locator("#btnBbVisual").click();

  const pitcherSelect = page.locator('.baseball-player-slot[data-position="P"] .baseball-defense-select');
  await expect(pitcherSelect).toHaveValue(secondMember.name);
  await expect(page.locator('.baseball-player-slot[data-position="P"] .sport-player-name')).toHaveText(secondMember.name);
  await expect(page.locator('.baseball-player-slot[data-position="P"] .sport-player-image')).toHaveAttribute("src", secondMember.photo);
  await expect(page.locator('.baseball-player-slot[data-position="P"] .sport-player-image')).toHaveCSS("border-radius", "4px");

  await pitcherSelect.selectOption(firstMember.name);
  await expect(battingSelect).toHaveValue(firstMember.name);
});