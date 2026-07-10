import { config as loadEnv } from "dotenv";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { fromThrowable } from "neverthrow";
import { Pool } from "pg";
import type { DatabaseInstance } from "@core/database/client";
import * as schema from "@core/database/schema";
import {
   invitation as invitationTable,
   member,
   organization,
   team,
   user as userTable,
} from "@core/database/schemas/auth";
import { bankAccounts } from "@core/database/schemas/bank-accounts";
import { creditCards } from "@core/database/schemas/credit-cards";
import { categories } from "@core/database/schemas/categories";
import { parties } from "@core/database/schemas/relationships";
import { tags } from "@core/database/schemas/tags";
import {
   transactionRecurrences,
   transactions,
} from "@core/database/schemas/transactions";

loadEnv({
   path: path.join(import.meta.dirname, "..", "..", "web", ".env.local"),
});

assertLocalOnly();

function assertLocalOnly() {
   const url = process.env.DATABASE_URL;
   if (!url) {
      throw new Error("DATABASE_URL is not set for e2e");
   }
   const parse = fromThrowable(
      (raw: string) => new URL(raw),
      () => null,
   );
   const host = parse(url)
      .map((u) => u.host)
      .unwrapOr("");
   if (!/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
      throw new Error(
         `e2e refuses non-local DATABASE_URL: "${url}". Only localhost/127.0.0.1 allowed.`,
      );
   }
}

type CachedDb = {
   db: DatabaseInstance;
   pool: Pool;
};

type TeamRecord = typeof team.$inferSelect;

let cachedDb: CachedDb | undefined;

function db(): DatabaseInstance {
   if (!cachedDb) {
      const pool = new Pool({
         connectionString: process.env.DATABASE_URL ?? "",
         max: 2,
      });
      cachedDb = {
         db: drizzle({
            casing: "snake_case",
            client: pool,
            schema,
         }),
         pool,
      };
   }
   return cachedDb.db;
}

export async function closeDb() {
   if (!cachedDb) return;
   await cachedDb.pool.end();
   cachedDb = undefined;
}

export async function findUserByEmail(email: string) {
   return db().query.user.findFirst({ where: eq(userTable.email, email) });
}

export async function findFirstOrgByUserEmail(email: string) {
   const u = await findUserByEmail(email);
   if (!u) return null;
   const member = await db().query.member.findFirst({
      where: (f, { eq: eqOp }) => eqOp(f.userId, u.id),
      with: { organization: true },
   });
   return member?.organization ?? null;
}

export async function findTeamByOrgAndSlug(
   orgSlug: string,
   teamSlug: string,
): Promise<TeamRecord | null> {
   const org = await db().query.organization.findFirst({
      where: (f, { eq: eqOp }) => eqOp(f.slug, orgSlug),
   });
   if (!org) return null;

   const foundTeam = await db().query.team.findFirst({
      where: (f, { and, eq: eqOp }) =>
         and(eqOp(f.organizationId, org.id), eqOp(f.slug, teamSlug)),
   });
   return foundTeam ?? null;
}

export async function clearUserAvatarByEmail(email: string) {
   await db()
      .update(userTable)
      .set({ image: null })
      .where(eq(userTable.email, email));
}

export async function clearOrganizationLogoForEmail(email: string) {
   const org = await findFirstOrgByUserEmail(email);
   if (!org) return;
   await db()
      .update(organization)
      .set({ logo: null })
      .where(eq(organization.id, org.id));
}

export async function findPendingInvitationByEmail(email: string) {
   return db().query.invitation.findFirst({
      where: (f, { eq, and }) =>
         and(eq(f.email, email), eq(f.status, "pending")),
   });
}

export async function findInvitationByEmail(email: string) {
   return db().query.invitation.findFirst({
      where: (f, { eq }) => eq(f.email, email),
      orderBy: (f, { desc }) => [desc(f.createdAt)],
   });
}

export async function isUserMemberOfOrgByEmail(
   email: string,
   organizationId: string,
) {
   const u = await findUserByEmail(email);
   if (!u) return false;
   const m = await db().query.member.findFirst({
      where: (f, { eq, and }) =>
         and(eq(f.userId, u.id), eq(f.organizationId, organizationId)),
   });
   return !!m;
}

export async function deleteInvitationsByEmail(email: string) {
   await db().delete(invitationTable).where(eq(invitationTable.email, email));
}

export async function deleteUserByEmail(email: string) {
   const u = await findUserByEmail(email);
   if (!u) return;
   await db().delete(userTable).where(eq(userTable.id, u.id));
}

export async function clearUserName(email: string) {
   await db()
      .update(userTable)
      .set({ name: "" })
      .where(eq(userTable.email, email));
}

export async function markOnboardingIncomplete(orgSlug: string) {
   const org = await db().query.organization.findFirst({
      where: (f, { eq: eqOp }) => eqOp(f.slug, orgSlug),
   });
   if (!org) return;
   await db()
      .update(organization)
      .set({ onboardingCompleted: false })
      .where(eq(organization.id, org.id));
   await db()
      .update(team)
      .set({ onboardingCompleted: false })
      .where(eq(team.organizationId, org.id));
}

export async function findTeamsByOrgSlug(
   orgSlug: string,
): Promise<TeamRecord[]> {
   const org = await db().query.organization.findFirst({
      where: (f, { eq: eqOp }) => eqOp(f.slug, orgSlug),
   });
   if (!org) return [];
   return db().query.team.findMany({
      where: (f, { eq: eqOp }) => eqOp(f.organizationId, org.id),
   });
}

export async function addMemberToOrg(
   userId: string,
   organizationId: string,
   role = "member",
) {
   await db().insert(member).values({
      userId,
      organizationId,
      role,
      createdAt: new Date(),
   });
}

export async function findBankAccountByName(teamId: string, name: string) {
   return db().query.bankAccounts.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.name, name)),
   });
}

export async function deleteBankAccountById(teamId: string, id: string) {
   await db()
      .delete(bankAccounts)
      .where(and(eq(bankAccounts.teamId, teamId), eq(bankAccounts.id, id)));
}

export async function findPartyByName(teamId: string, name: string) {
   return db().query.parties.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.name, name)),
   });
}

export async function findPartiesByDocument(
   teamId: string,
   role: "customer" | "supplier",
   documentNumber: string,
) {
   return db().query.parties.findMany({
      where: (f, { and, eq }) =>
         and(
            eq(f.teamId, teamId),
            eq(f.role, role),
            eq(f.documentNumber, documentNumber),
         ),
   });
}

export async function deletePartyById(teamId: string, id: string) {
   await db()
      .delete(parties)
      .where(and(eq(parties.teamId, teamId), eq(parties.id, id)));
}

export async function findCreditCardByName(teamId: string, name: string) {
   return db().query.creditCards.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.name, name)),
   });
}

export async function deleteCreditCardById(teamId: string, id: string) {
   await db()
      .delete(creditCards)
      .where(and(eq(creditCards.teamId, teamId), eq(creditCards.id, id)));
}

export async function findAnyBankAccount(teamId: string) {
   return db().query.bankAccounts.findFirst({
      where: (f, { eq }) => eq(f.teamId, teamId),
   });
}

export async function insertBankAccount(
   teamId: string,
   name: string,
   extras?: { bankCode?: string; bankName?: string },
) {
   const [row] = await db()
      .insert(bankAccounts)
      .values({
         teamId,
         name,
         type: extras?.bankCode ? "checking" : "cash",
         color: "#6366f1",
         initialBalance: "0",
         bankCode: extras?.bankCode ?? null,
         bankName: extras?.bankName ?? null,
      })
      .returning();
   return row;
}

export async function findTransactionById(teamId: string, id: string) {
   return db().query.transactions.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.id, id)),
   });
}

export async function findTransactionByName(teamId: string, name: string) {
   return db().query.transactions.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.name, name)),
   });
}

export async function findTransactionsByName(teamId: string, name: string) {
   return db().query.transactions.findMany({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.name, name)),
      orderBy: (f, { asc }) => [
         asc(f.recurrenceOccurrenceNumber),
         asc(f.installmentNumber),
         asc(f.createdAt),
      ],
   });
}

export async function findTransactionsByInstallmentGroupId(
   teamId: string,
   installmentGroupId: string,
) {
   return db().query.transactions.findMany({
      where: (f, { and, eq }) =>
         and(
            eq(f.teamId, teamId),
            eq(f.installmentGroupId, installmentGroupId),
         ),
      orderBy: (f, { asc }) => [asc(f.installmentNumber)],
   });
}

export async function findTransactionRecurrenceById(
   teamId: string,
   id: string,
) {
   return db().query.transactionRecurrences.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.id, id)),
   });
}

export async function deleteTransactionRecurrenceById(
   teamId: string,
   id: string,
) {
   await db()
      .delete(transactionRecurrences)
      .where(
         and(
            eq(transactionRecurrences.teamId, teamId),
            eq(transactionRecurrences.id, id),
         ),
      );
}

export async function insertExpenseTransaction(
   teamId: string,
   bankAccountId: string,
   name: string,
   status: "pending" | "paid" | "cancelled" = "pending",
) {
   const [row] = await db()
      .insert(transactions)
      .values({
         teamId,
         name,
         type: "expense",
         amount: "10.00",
         date: new Date().toISOString().slice(0, 10),
         bankAccountId,
         status,
      })
      .returning();
   if (!row) throw new Error("Failed to insert transaction");
   return row;
}

export async function insertExpenseTransactions(
   teamId: string,
   bankAccountId: string,
   expenses: Array<{ name: string; date: string }>,
) {
   return db()
      .insert(transactions)
      .values(
         expenses.map((expense): typeof transactions.$inferInsert => ({
            teamId,
            name: expense.name,
            type: "expense",
            amount: "10.00",
            date: expense.date,
            bankAccountId,
            status: "pending",
         })),
      )
      .returning();
}

export async function deleteTransactionsByIds(teamId: string, ids: string[]) {
   if (ids.length === 0) return;

   await db()
      .delete(transactions)
      .where(
         and(eq(transactions.teamId, teamId), inArray(transactions.id, ids)),
      );
}

export async function deleteTransactionById(teamId: string, id: string) {
   await db()
      .delete(transactions)
      .where(and(eq(transactions.teamId, teamId), eq(transactions.id, id)));
}

export async function findCategoryByName(teamId: string, name: string) {
   return db().query.categories.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.name, name)),
   });
}

export async function insertDefaultCategory(
   teamId: string,
   name: string,
   type: "income" | "expense" | "transfer" = "expense",
) {
   const [row] = await db()
      .insert(categories)
      .values({
         teamId,
         name,
         type,
         level: 1,
         isDefault: true,
         participatesDre: false,
      })
      .returning();
   return row;
}

export async function insertCategory(
   teamId: string,
   input: {
      name: string;
      type: "income" | "expense" | "transfer";
      parentId?: string;
   },
) {
   const [row] = await db()
      .insert(categories)
      .values({
         teamId,
         name: input.name,
         type: input.type,
         parentId: input.parentId,
         level: input.parentId ? 2 : 1,
         isDefault: false,
         participatesDre: false,
      })
      .returning();
   if (!row) throw new Error(`Falha ao inserir categoria "${input.name}".`);
   return row;
}

export async function deleteCategoryById(teamId: string, id: string) {
   await db()
      .delete(categories)
      .where(and(eq(categories.teamId, teamId), eq(categories.id, id)));
}

export async function findTagByName(teamId: string, name: string) {
   return db().query.tags.findFirst({
      where: (f, { and, eq }) => and(eq(f.teamId, teamId), eq(f.name, name)),
   });
}

export async function findTagById(id: string) {
   return db().query.tags.findFirst({
      where: (f, { eq }) => eq(f.id, id),
   });
}

export async function insertTag(
   teamId: string,
   name: string,
   description: string | null = null,
) {
   const [row] = await db()
      .insert(tags)
      .values({ teamId, name, description })
      .returning();
   if (!row) throw new Error("Failed to insert tag");
   return row;
}

export async function deleteTagById(teamId: string, id: string) {
   await db()
      .delete(tags)
      .where(and(eq(tags.teamId, teamId), eq(tags.id, id)));
}

export async function findTeamMembership(teamId: string, userId: string) {
   return db().query.teamMember.findFirst({
      where: (f, { and, eq: eqOp }) =>
         and(eqOp(f.teamId, teamId), eqOp(f.userId, userId)),
   });
}

export async function countMemberOrgsByEmail(email: string) {
   const u = await findUserByEmail(email);
   if (!u) return 0;
   const members = await db().query.member.findMany({
      where: (f, { eq: eqOp }) => eqOp(f.userId, u.id),
   });
   return members.length;
}
