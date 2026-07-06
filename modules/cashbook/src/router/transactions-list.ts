import {
   ConditionGroup,
   evaluateConditionGroup,
} from "@f-o-t/condition-evaluator";
import { Result, TaggedError } from "better-result";
import { of, toDecimal } from "@f-o-t/money";
import { count, sql } from "drizzle-orm";
import { defineErrorCatalog } from "evlog";
import { z } from "zod";
import { transactions } from "@core/database/schemas/transactions";
import { protectedProcedure } from "@core/orpc/server";
import {
   buildTransactionWhere,
   selectTransactionsWithJoins,
   type TransactionFilter,
   type TransactionSortId,
} from "@modules/cashbook/transactions";

const transactionsListRouterErrors = defineErrorCatalog(
   "cashbook.router.transactions-list",
   {
      LIST_FAILED: {
         status: 500,
         message: "Falha ao listar lançamentos.",
         tags: ["cashbook", "transactions", "router"],
      },
      SUMMARY_FAILED: {
         status: 500,
         message: "Falha ao carregar resumo de lançamentos.",
         tags: ["cashbook", "transactions", "router"],
      },
   },
);

declare module "evlog" {
   interface RegisteredErrorCatalogs {
      "cashbook.router.transactions-list": typeof transactionsListRouterErrors;
   }
}

type TransactionsListRouterCatalogError =
   | ReturnType<typeof transactionsListRouterErrors.LIST_FAILED>
   | ReturnType<typeof transactionsListRouterErrors.SUMMARY_FAILED>;

class TransactionsListRouterError extends TaggedError(
   "TransactionsListRouterError",
)<{
   error: TransactionsListRouterCatalogError;
   message: string;
}>() {}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txStatus = z.enum(["pending", "paid", "cancelled"]);
const sortIdSchema = z.enum([
   "amount",
   "bankAccountName",
   "categoryName",
   "creditCardName",
   "date",
   "dueDate",
   "name",
   "paymentMethod",
   "relationshipName",
   "status",
   "type",
]);
const sortingSchema = z.array(
   z.object({
      id: sortIdSchema,
      desc: z.boolean(),
   }),
);

type SortingInput = z.infer<typeof sortingSchema>;

function normalizeSorting(sorting: SortingInput | undefined) {
   return sorting?.map((rule) => ({
      id: rule.id satisfies TransactionSortId,
      desc: rule.desc,
   }));
}

const filterSchema = z
   .object({
      type: z.enum(["income", "expense", "transfer"]).optional(),
      bankAccountId: z.string().uuid().optional(),
      relationshipId: z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
      tagId: z.string().uuid().optional(),
      dateFrom: isoDate.optional(),
      dateTo: isoDate.optional(),
      search: z.string().max(100).optional(),
      creditCardId: z.string().uuid().optional(),
      uncategorized: z.boolean().optional(),
      paymentMethod: z.string().optional(),
      status: z.union([txStatus, z.array(txStatus)]).optional(),
      dueDateFrom: isoDate.optional(),
      dueDateTo: isoDate.optional(),
      overdueOnly: z.boolean().optional(),
      view: z
         .enum(["all", "payable", "receivable", "settled", "ignored"])
         .optional(),
      ignored: z.boolean().optional(),
      all: z.boolean().optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(20),
      conditionGroup: ConditionGroup.optional(),
      sorting: sortingSchema.optional(),
   })
   .optional();

export const getAll = protectedProcedure
   .input(filterSchema)
   .handler(async ({ context, input }) => {
      const result = await Result.tryPromise({
         try: async () => {
            const filtersIgnored =
               input?.ignored === true ||
               input?.view === "ignored" ||
               input?.view === "all";
            const filter: TransactionFilter = {
               teamId: context.teamId,
               ...input,
               includeIgnored: filtersIgnored,
            };
            const page = filter.page ?? 1;
            const pageSize = filter.pageSize ?? 20;
            const where = buildTransactionWhere(filter);
            const cg = filter.conditionGroup;

            if (cg?.scoringMode === "weighted") {
               const allRows = await selectTransactionsWithJoins(
                  context.db,
                  where,
                  normalizeSorting(filter.sorting),
               );
               const filtered = allRows.filter(
                  (row) =>
                     evaluateConditionGroup(cg, {
                        data: {
                           categoryId: row.categoryId ?? null,
                           bankAccountId: row.bankAccountId,
                           relationshipId: row.relationshipId ?? null,
                           creditCardId: row.creditCardId ?? null,
                           amount: Number(row.amount),
                           name: row.name ?? row.description ?? "",
                        },
                     }).passed,
               );
               const data =
                  input?.all === true
                     ? filtered
                     : filtered.slice((page - 1) * pageSize, page * pageSize);
               return {
                  data,
                  total: filtered.length,
               };
            }

            const [countRow] = await context.db
               .select({ total: count() })
               .from(transactions)
               .where(where);

            const dataQuery = selectTransactionsWithJoins(
               context.db,
               where,
               normalizeSorting(filter.sorting),
            );
            const data =
               input?.all === true
                  ? await dataQuery
                  : await dataQuery
                       .limit(pageSize)
                       .offset((page - 1) * pageSize);

            return { data, total: countRow?.total ?? 0 };
         },
         catch: () =>
            new TransactionsListRouterError({
               error: transactionsListRouterErrors.LIST_FAILED(),
               message: "Falha ao listar lançamentos.",
            }),
      });
      if (Result.isError(result)) throw result.error;
      return result.value;
   });

export const getSummary = protectedProcedure
   .input(filterSchema)
   .handler(async ({ context, input }) => {
      const result = await Result.tryPromise({
         try: async () => {
            const filtersIgnored =
               input?.ignored === true ||
               input?.view === "ignored" ||
               input?.view === "all";
            const filter: TransactionFilter = {
               teamId: context.teamId,
               ...input,
               includeIgnored: filtersIgnored,
            };
            const where = buildTransactionWhere(filter);
            const t = transactions;
            const [row] = await context.db
               .select({
                  totalCount: count(),
                  incomeTotal: sql<string>`COALESCE(SUM(CASE WHEN ${t.type} = 'income' THEN ${t.amount} ELSE 0 END), 0)`,
                  expenseTotal: sql<string>`COALESCE(SUM(CASE WHEN ${t.type} = 'expense' THEN ${t.amount} ELSE 0 END), 0)`,
                  balance: sql<string>`COALESCE(SUM(CASE WHEN ${t.type} = 'income' THEN ${t.amount} WHEN ${t.type} = 'expense' THEN -${t.amount} ELSE 0 END), 0)`,
               })
               .from(t)
               .where(where);

            const c = "BRL";
            return {
               totalCount: row?.totalCount ?? 0,
               incomeTotal: toDecimal(of(row?.incomeTotal ?? "0", c)),
               expenseTotal: toDecimal(of(row?.expenseTotal ?? "0", c)),
               balance: toDecimal(of(row?.balance ?? "0", c)),
            };
         },
         catch: () =>
            new TransactionsListRouterError({
               error: transactionsListRouterErrors.SUMMARY_FAILED(),
               message: "Falha ao carregar resumo de lançamentos.",
            }),
      });
      if (Result.isError(result)) throw result.error;
      return result.value;
   });
