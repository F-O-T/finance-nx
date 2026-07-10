import { expect, test } from "../fixtures";
import {
   deleteBankAccountById,
   deleteTransactionsByIds,
   findTeamByOrgAndSlug,
   insertBankAccount,
   insertExpenseTransactions,
} from "../helpers/db";

test("sort + pagination state syncs to URL and survives reload", async ({
   page,
   e2eSession,
}) => {
   await page.goto(
      `/${e2eSession.orgSlug}/${e2eSession.teamSlug}/transactions`,
   );
   await expect(
      page.getByRole("heading", { name: "Lançamentos" }),
   ).toBeVisible();

   const dateHeader = page.getByRole("cell", { name: "Data" }).first();
   await dateHeader.click();
   await page.waitForURL(/sorting=/);
   expect(page.url()).toContain("sorting=");

   await page.reload();
   await expect(
      page.getByRole("heading", { name: "Lançamentos" }),
   ).toBeVisible();
   expect(page.url()).toContain("sorting=");

   const pageSizeSelect = page
      .getByRole("combobox")
      .filter({ hasText: /\d+/ })
      .first();
   await pageSizeSelect.click();
   await page.getByRole("option", { name: "50" }).click();
   await page.waitForURL(/pageSize=50/);
   expect(page.url()).toContain("pageSize=50");
});

test("página 2 mostra o 101º lançamento filtrado por conta", async ({
   page,
   e2eSession,
}) => {
   const team = await findTeamByOrgAndSlug(
      e2eSession.orgSlug,
      e2eSession.teamSlug,
   );
   if (!team) throw new Error("Time de E2E não encontrado.");

   const account = await insertBankAccount(team.id, "Conta E2E paginação URL");
   if (!account) throw new Error("Falha ao criar conta bancária de E2E.");

   const oldTransactionName = "Lançamento antigo único E2E";
   const transactionIds: string[] = [];

   try {
      const createdTransactions = await insertExpenseTransactions(
         team.id,
         account.id,
         [
            ...Array.from({ length: 100 }, (_, index) => ({
               name: `Lançamento recente E2E ${String(index + 1).padStart(3, "0")}`,
               date: "2025-01-02",
            })),
            { name: oldTransactionName, date: "2024-01-02" },
         ],
      );
      transactionIds.push(
         ...createdTransactions.map((transaction) => transaction.id),
      );

      await page.goto(
         `/${e2eSession.orgSlug}/${e2eSession.teamSlug}/transactions?bankId=${account.id}&pageSize=100`,
      );
      await expect(
         page.getByRole("heading", { name: "Lançamentos" }),
      ).toBeVisible();
      await expect(
         page
            .getByText(/^Lançamento recente E2E \d{3}$/, { exact: true })
            .first(),
      ).toBeVisible();

      const nextPageButton = page.getByRole("button", {
         name: "Próxima página",
      });
      await expect(nextPageButton).toBeEnabled();
      await Promise.all([page.waitForURL(/page=2/), nextPageButton.click()]);

      await expect(
         page.getByText(oldTransactionName, { exact: true }),
      ).toBeVisible();
   } finally {
      await deleteTransactionsByIds(team.id, transactionIds);
      await deleteBankAccountById(team.id, account.id);
   }
});
