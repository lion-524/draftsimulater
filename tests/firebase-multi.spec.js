import { test, expect } from "@playwright/test";

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

  await host.locator("#multiStartBtn").click();
  await expect(host.locator("#playerDropdown option").first()).toBeAttached();
  await expect(guest.locator("#playerDropdown option").first()).toBeAttached();
  await expect(host.locator("#loading")).toBeHidden();
  await expect(guest.locator("#loading")).toBeHidden();

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
  await expect.poll(() => guest.evaluate(() => teams.map(team => team.rank))).toEqual(expectedRanks);

  const sharedName = await host.locator("#playerDropdown option").nth(1).getAttribute("value");
  expect(sharedName).toBeTruthy();
  await host.locator("#playerDropdown").selectOption(sharedName);
  await guest.locator("#playerDropdown").selectOption(sharedName);
  await host.locator("#nominateBtn").click();
  await guest.locator("#nominateBtn").click();

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

  const hostWon = (await host.locator("#lotteryResultStamp").innerText()).includes("E2E Host");
  const loserPage = hostWon ? guest : host;
  await expect(loserPage.locator("#actionControls")).toBeVisible({ timeout: 60_000 });

  const nextName = await loserPage.locator("#playerDropdown option").evaluateAll((options, pickedName) =>
    options.map(option => option.value).find(value => value && value !== pickedName), sharedName
  );
  expect(nextName).toBeTruthy();
  await loserPage.locator("#playerDropdown").selectOption(nextName);
  await loserPage.locator("#nominateBtn").click();

  await expect(host.locator("#teamsContainer")).toContainText(nextName);
  await expect(guest.locator("#teamsContainer")).toContainText(nextName);
  await expect(host.locator("#teamsContainer")).toContainText(sharedName);
  await expect(guest.locator("#teamsContainer")).toContainText(sharedName);
  expect(errors).toEqual([]);

  await host.close();
  await guest.close();
});