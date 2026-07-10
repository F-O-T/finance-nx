import dayjs from "dayjs";
import {
   parseOrderByExpression,
   parseWhereExpression,
   queryCollectionOptions,
} from "@tanstack/query-db-collection";
import type { QueryClient } from "@tanstack/query-core";
import { createOptimisticAction } from "@tanstack/react-db";
import type { Collection, LoadSubsetOptions } from "@tanstack/react-db";
import { orpc, type Inputs, type Outputs } from "@/integrations/orpc/client";

export type TransactionsCollectionRow =
   Outputs["transactions"]["getAll"]["data"][number];

export type TransactionCreateInput = Inputs["transactions"]["create"];
export type TransactionUpdateInput = Inputs["transactions"]["update"];
export type TransactionImportBulkInput = Inputs["transactions"]["importBulk"];

type TransactionsCollectionInput = NonNullable<
   Inputs["transactions"]["getAll"]
>;

type TransactionSortId = NonNullable<
   TransactionsCollectionInput["sorting"]
>[number]["id"];

type TransactionsCollectionOptionsParams = {
   queryClient: QueryClient;
   teamId: string;
   page: number;
   pageSize: number;
   search?: string;
   view?: "all" | "payable" | "receivable" | "settled" | "ignored";
   overdueOnly?: boolean;
   status?: Array<"pending" | "paid">;
   bankAccountId?: string;
   dateFrom?: string;
   dateTo?: string;
   dueDateFrom?: string;
   dueDateTo?: string;
   relationshipId?: string;
};

type TransactionsPageInfoCollectionOptionsParams = {
   queryClient: QueryClient;
   teamId: string;
   search?: string;
   view?: "all" | "payable" | "receivable" | "settled" | "ignored";
   overdueOnly?: boolean;
   status?: Array<"pending" | "paid">;
   bankAccountId?: string;
   dateFrom?: string;
   dateTo?: string;
   dueDateFrom?: string;
   dueDateTo?: string;
   relationshipId?: string;
};

type TransactionCreateActionInput = {
   row: TransactionsCollectionRow;
   input: TransactionCreateInput;
};

type TransactionsWhereInput = {
   bankAccountId?: string;
   dateFrom?: string;
   dateTo?: string;
   dueDateFrom?: string;
   dueDateTo?: string;
   paymentMethod?: string;
   relationshipId?: string;
   overdueOnly?: boolean;
   search?: string;
   status?: Array<"pending" | "paid">;
   view?: "all" | "payable" | "receivable" | "settled" | "ignored";
};

type TransactionUpdateActionInput = {
   id: string;
   patch: Omit<TransactionUpdateInput, "id"> &
      Partial<
         Pick<
            TransactionsCollectionRow,
            | "bankAccountName"
            | "categoryName"
            | "creditCardName"
            | "relationshipName"
            | "suggestedCategoryName"
            | "suggestedTagName"
            | "tagName"
         >
      >;
};

type TransactionBulkUpdateActionInput = {
   ids: string[];
   patch: Omit<Inputs["transactions"]["bulkUpdate"], "ids">;
};

type TransactionIdActionInput = {
   id: string;
};

type TransactionMarkAsPaidActionInput = Inputs["transactions"]["markAsPaid"];

type TransactionImportActionInput = {
   rows: TransactionsCollectionRow[];
   input: TransactionImportBulkInput;
};

type TransactionsCollection = Collection<TransactionsCollectionRow, string>;

function cleanSearchPattern(value: unknown) {
   if (typeof value !== "string") return undefined;
   const cleaned = value
      .replace(/^%+|%+$/g, "")
      .replace(/\\([\\%_])/g, "$1")
      .trim();
   return cleaned || undefined;
}

function parseTransactionStatus(value: unknown) {
   if (value === "pending" || value === "paid") return value;
   return undefined;
}

function parseTransactionView(value: unknown) {
   if (
      value === "all" ||
      value === "payable" ||
      value === "receivable" ||
      value === "settled" ||
      value === "ignored"
   ) {
      return value;
   }
   return undefined;
}

function mergeWhere(filters: TransactionsWhereInput[]): TransactionsWhereInput {
   return filters.reduce((acc, filter) => ({ ...acc, ...filter }), {});
}

function parseTransactionsWhere(options: LoadSubsetOptions | undefined) {
   return (
      parseWhereExpression<TransactionsWhereInput>(options?.where, {
         handlers: {
            eq: (field: Array<string | number>, value: unknown) => {
               const key = field.join(".");
               if (key === "bankAccountId" && typeof value === "string") {
                  return { bankAccountId: value };
               }
               if (key === "date" && typeof value === "string") {
                  return { dateFrom: value, dateTo: value };
               }
               if (key === "dueDate" && typeof value === "string") {
                  return { dueDateFrom: value, dueDateTo: value };
               }
               if (key === "paymentMethod" && typeof value === "string") {
                  return { paymentMethod: value };
               }
               if (key === "relationshipId" && typeof value === "string") {
                  return { relationshipId: value };
               }
               if (key === "view") return { view: parseTransactionView(value) };
               if (key === "overdueOnly" && value === true) {
                  return { overdueOnly: true };
               }
               if (key === "status") {
                  const parsed = parseTransactionStatus(value);
                  return parsed ? { status: [parsed] } : {};
               }
               return {};
            },
            ilike: (field: Array<string | number>, value: unknown) => {
               const key = field.join(".");
               if (key !== "name" && key !== "description") return {};
               return { search: cleanSearchPattern(value) };
            },
            and: (...filters: TransactionsWhereInput[]) => mergeWhere(filters),
            or: (...filters: TransactionsWhereInput[]) => {
               const search = filters.find((filter) => filter.search)?.search;
               const statuses = filters.flatMap(
                  (filter) => filter.status ?? [],
               );
               if (search) return { search };
               if (statuses.length > 0) return { status: statuses };
               return {};
            },
         },
         onUnknownOperator: () => ({}),
      }) ?? {}
   );
}

function parseTransactionSortId(value: string): TransactionSortId | undefined {
   switch (value) {
      case "amount":
      case "bankAccountName":
      case "categoryName":
      case "creditCardName":
      case "date":
      case "dueDate":
      case "name":
      case "paymentMethod":
      case "relationshipName":
      case "status":
      case "type":
         return value;
   }
}

function parseTransactionsSorting(options: LoadSubsetOptions | undefined) {
   return parseOrderByExpression(options?.orderBy)
      .map((sort) => {
         const id = parseTransactionSortId(sort.field.join("."));
         if (!id) return undefined;
         return { id, desc: sort.direction === "desc" };
      })
      .filter((sort) => sort !== undefined);
}

function transactionsInputFromLoadSubsetOptions(
   options: LoadSubsetOptions | undefined,
   base: Omit<TransactionsCollectionOptionsParams, "queryClient" | "teamId">,
): TransactionsCollectionInput {
   const where = parseTransactionsWhere(options);
   const sorting = parseTransactionsSorting(options);
   const pageSize = Math.min(100, Math.max(1, options?.limit ?? base.pageSize));
   const offset = (base.page - 1) * base.pageSize + (options?.offset ?? 0);

   return {
      page: Math.floor(offset / pageSize) + 1,
      pageSize,
      search: where.search ?? base.search,
      view: where.view ?? base.view,
      overdueOnly: where.overdueOnly ?? base.overdueOnly,
      status:
         where.status && where.status.length > 0 ? where.status : base.status,
      bankAccountId: where.bankAccountId ?? base.bankAccountId,
      dateFrom: where.dateFrom ?? base.dateFrom,
      dateTo: where.dateTo ?? base.dateTo,
      dueDateFrom: where.dueDateFrom ?? base.dueDateFrom,
      dueDateTo: where.dueDateTo ?? base.dueDateTo,
      paymentMethod: where.paymentMethod,
      relationshipId: where.relationshipId ?? base.relationshipId,
      sorting,
   };
}

function hasLoadSubsetOptions(options: LoadSubsetOptions | undefined) {
   return Boolean(
      options?.where ||
      options?.orderBy?.length ||
      options?.limit !== undefined ||
      options?.offset !== undefined,
   );
}

async function safeRefetchTransactions(collection: TransactionsCollection) {
   await collection.utils.refetch().catch(() => {});
}

export function buildOptimisticTransactionRowId(prefix = "__transaction_") {
   if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") {
         return `${prefix}${crypto.randomUUID()}`;
      }

      if (typeof crypto.getRandomValues === "function") {
         const bytes = new Uint8Array(16);
         crypto.getRandomValues(bytes);
         const hex = Array.from(bytes, (byte) =>
            byte.toString(16).padStart(2, "0"),
         ).join("");
         return `${prefix}${hex}`;
      }
   }

   return `${prefix}${dayjs().valueOf().toString(36)}`;
}

export function buildOptimisticTransactionRow({
   id,
   input,
   teamId,
   bankAccountName,
   categoryName,
   creditCardName,
   relationshipName,
   tagName,
}: {
   id: string;
   input: TransactionCreateInput;
   teamId: string;
   bankAccountName?: string | null;
   categoryName?: string | null;
   creditCardName?: string | null;
   relationshipName?: string | null;
   tagName?: string | null;
}): TransactionsCollectionRow {
   const now = dayjs().toDate();
   return {
      id,
      teamId,
      name: input.name ?? null,
      type: input.type,
      amount: input.amount,
      description: input.description ?? null,
      date: input.date,
      bankAccountId: input.bankAccountId ?? null,
      destinationBankAccountId: input.destinationBankAccountId ?? null,
      creditCardId: input.creditCardId ?? null,
      categoryId: input.categoryId ?? null,
      suggestedCategoryId: null,
      attachments: input.attachments ?? null,
      paymentMethod: input.paymentMethod ?? null,
      status: input.status ?? "paid",
      ignored: input.ignored ?? false,
      dueDate: input.dueDate ?? null,
      installmentGroupId: null,
      installmentNumber: null,
      installmentCount: null,
      recurrenceId: null,
      recurrenceOccurrenceNumber: null,
      paidAt: input.paidAt ?? null,
      statementPeriod: input.statementPeriod ?? null,
      tagId: input.tagId ?? null,
      suggestedTagId: null,
      relationshipId: input.relationshipId ?? null,
      createdAt: now,
      updatedAt: now,
      categoryName: categoryName ?? null,
      creditCardName: creditCardName ?? null,
      bankAccountName: bankAccountName ?? null,
      relationshipName: relationshipName ?? null,
      suggestedCategoryName: null,
      tagName: tagName ?? null,
      suggestedTagName: null,
   };
}

export function transactionsCollectionOptions({
   queryClient,
   teamId,
   page,
   pageSize,
   search,
   view,
   overdueOnly,
   status,
   bankAccountId,
   dateFrom,
   dateTo,
   dueDateFrom,
   dueDateTo,
   relationshipId,
}: TransactionsCollectionOptionsParams) {
   const base = {
      page,
      pageSize,
      search,
      view,
      overdueOnly,
      status,
      bankAccountId,
      dateFrom,
      dateTo,
      dueDateFrom,
      dueDateTo,
      relationshipId,
   };
   return queryCollectionOptions({
      id: [
         "transactions",
         teamId,
         page,
         pageSize,
         search ?? "",
         view ?? "all",
         overdueOnly ? "overdue" : "all-dates",
         status?.join(",") ?? "all-status",
         bankAccountId ?? "all-accounts",
         dateFrom ?? "open-start",
         dateTo ?? "open-end",
         dueDateFrom ?? "open-due-start",
         dueDateTo ?? "open-due-end",
         relationshipId ?? "all-relationships",
      ].join(":"),
      queryKey: (options) =>
         hasLoadSubsetOptions(options)
            ? [
                 "transactions",
                 teamId,
                 transactionsInputFromLoadSubsetOptions(options, base),
              ]
            : ["transactions", teamId, base],
      queryFn: async (ctx) => {
         const result = await orpc.transactions.getAll.call(
            transactionsInputFromLoadSubsetOptions(
               ctx.meta?.loadSubsetOptions,
               base,
            ),
         );
         return result.data;
      },
      queryClient,
      getKey: (transaction: TransactionsCollectionRow) => transaction.id,
      meta: {
         notifyOnError: true,
         errorMessage: "Não foi possível sincronizar os lançamentos.",
      },
      refetchInterval: 5_000,
      syncMode: "on-demand",
   });
}

export type TransactionsPageInfoCollectionRow = {
   id: string;
   total: number;
};

export function transactionsPageInfoCollectionOptions({
   queryClient,
   teamId,
   search,
   view,
   overdueOnly,
   status,
   bankAccountId,
   dateFrom,
   dateTo,
   dueDateFrom,
   dueDateTo,
   relationshipId,
}: TransactionsPageInfoCollectionOptionsParams) {
   const id = [
      teamId,
      search ?? "",
      view ?? "all",
      overdueOnly ? "overdue" : "all-dates",
      status?.join(",") ?? "all-status",
      bankAccountId ?? "all-accounts",
      dateFrom ?? "open-start",
      dateTo ?? "open-end",
      dueDateFrom ?? "open-due-start",
      dueDateTo ?? "open-due-end",
      relationshipId ?? "all-relationships",
   ].join(":");
   return queryCollectionOptions({
      id: `transactions-page-info:${id}`,
      queryKey: () => [
         "transactions",
         teamId,
         "page-info",
         search,
         view,
         overdueOnly,
         status,
         bankAccountId,
         dateFrom,
         dateTo,
         dueDateFrom,
         dueDateTo,
         relationshipId,
      ],
      queryFn: async () => {
         const result = await orpc.transactions.getAll.call({
            page: 1,
            pageSize: 1,
            search,
            view,
            overdueOnly,
            status,
            bankAccountId,
            dateFrom,
            dateTo,
            dueDateFrom,
            dueDateTo,
            relationshipId,
         });
         return [{ id, total: result.total }];
      },
      queryClient,
      getKey: (row: TransactionsPageInfoCollectionRow) => row.id,
      meta: {
         notifyOnError: true,
         errorMessage: "Não foi possível sincronizar os lançamentos.",
      },
      refetchInterval: 5_000,
   });
}

export function updateTransactionAction(collection: TransactionsCollection) {
   return createOptimisticAction<TransactionUpdateActionInput>({
      onMutate: ({ id, patch }) => {
         collection.update(id, (draft) => {
            if (patch.amount !== undefined) draft.amount = patch.amount;
            if (patch.attachments !== undefined)
               draft.attachments = patch.attachments;
            if (patch.bankAccountId !== undefined)
               draft.bankAccountId = patch.bankAccountId;
            if (patch.bankAccountName !== undefined)
               draft.bankAccountName = patch.bankAccountName;
            if (patch.categoryId !== undefined) {
               draft.categoryId = patch.categoryId;
               draft.categoryName = patch.categoryName ?? null;
               draft.suggestedCategoryId = null;
               draft.suggestedCategoryName = null;
            } else if (patch.categoryName !== undefined) {
               draft.categoryName = patch.categoryName;
            }
            if (patch.creditCardId !== undefined)
               draft.creditCardId = patch.creditCardId;
            if (patch.creditCardName !== undefined)
               draft.creditCardName = patch.creditCardName;
            if (patch.date !== undefined) draft.date = patch.date;
            if (patch.description !== undefined)
               draft.description = patch.description;
            if (patch.destinationBankAccountId !== undefined) {
               draft.destinationBankAccountId = patch.destinationBankAccountId;
            }
            if (patch.dueDate !== undefined) draft.dueDate = patch.dueDate;
            if (patch.ignored !== undefined) draft.ignored = patch.ignored;
            if (patch.name !== undefined) draft.name = patch.name;
            if (patch.relationshipId !== undefined) {
               draft.relationshipId = patch.relationshipId;
               draft.relationshipName = patch.relationshipName ?? null;
            } else if (patch.relationshipName !== undefined) {
               draft.relationshipName = patch.relationshipName;
            }
            if (patch.paidAt !== undefined) draft.paidAt = patch.paidAt;
            if (patch.paymentMethod !== undefined)
               draft.paymentMethod = patch.paymentMethod;
            if (patch.statementPeriod !== undefined) {
               draft.statementPeriod = patch.statementPeriod;
            }
            if (patch.status !== undefined) draft.status = patch.status;
            if (patch.tagId !== undefined) {
               draft.tagId = patch.tagId;
               draft.suggestedTagId = null;
               draft.suggestedTagName = null;
            }
            if (patch.tagName !== undefined) draft.tagName = patch.tagName;
            if (patch.type !== undefined) draft.type = patch.type;
            draft.updatedAt = dayjs().toDate();
         });
      },
      mutationFn: async ({ id, patch }) => {
         const updated = await orpc.transactions.update.call({ id, ...patch });
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}

export function createTransactionAction(collection: TransactionsCollection) {
   return createOptimisticAction<TransactionCreateActionInput>({
      onMutate: ({ row }) => {
         collection.insert(row);
      },
      mutationFn: async ({ input }) => {
         const created = await orpc.transactions.create.call(input);
         await safeRefetchTransactions(collection);
         return created;
      },
   });
}

export function bulkUpdateTransactionsAction(
   collection: TransactionsCollection,
) {
   return createOptimisticAction<TransactionBulkUpdateActionInput>({
      onMutate: ({ ids, patch }) => {
         collection.update(ids, (drafts) => {
            for (const draft of drafts) {
               if (patch.bankAccountId !== undefined) {
                  draft.bankAccountId = patch.bankAccountId;
               }
               if (patch.categoryId !== undefined) {
                  draft.categoryId = patch.categoryId;
                  draft.categoryName = null;
                  draft.suggestedCategoryId = null;
                  draft.suggestedCategoryName = null;
               }
               if (patch.date !== undefined) draft.date = patch.date;
               if (patch.dueDate !== undefined) draft.dueDate = patch.dueDate;
               if (patch.ignored !== undefined) draft.ignored = patch.ignored;
               if (patch.relationshipId !== undefined) {
                  draft.relationshipId = patch.relationshipId;
                  draft.relationshipName = null;
               }
               if (patch.status !== undefined) draft.status = patch.status;
               draft.updatedAt = dayjs().toDate();
            }
         });
      },
      mutationFn: async ({ ids, patch }) => {
         const updated = await orpc.transactions.bulkUpdate.call({
            ids,
            ...patch,
         });
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}

export function removeTransactionAction(collection: TransactionsCollection) {
   return createOptimisticAction<TransactionIdActionInput>({
      onMutate: ({ id }) => {
         collection.delete(id);
      },
      mutationFn: async ({ id }) => {
         const removed = await orpc.transactions.remove.call({ id });
         await safeRefetchTransactions(collection);
         return removed;
      },
   });
}

export function bulkRemoveTransactionsAction(
   collection: TransactionsCollection,
) {
   return createOptimisticAction<{ ids: string[] }>({
      onMutate: ({ ids }) => {
         collection.delete(ids);
      },
      mutationFn: async ({ ids }) => {
         const removed = await orpc.transactions.bulkRemove.call({ ids });
         await safeRefetchTransactions(collection);
         return removed;
      },
   });
}

export function markTransactionAsPaidAction(
   collection: TransactionsCollection,
) {
   return createOptimisticAction<TransactionMarkAsPaidActionInput>({
      onMutate: ({ id, paidDate, bankAccountId }) => {
         collection.update(id, (draft) => {
            draft.status = "paid";
            draft.ignored = false;
            draft.paidAt = dayjs().toDate();
            draft.date = paidDate ?? dayjs().format("YYYY-MM-DD");
            if (bankAccountId !== undefined)
               draft.bankAccountId = bankAccountId;
         });
      },
      mutationFn: async (input) => {
         const updated = await orpc.transactions.markAsPaid.call(input);
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}

export function markTransactionAsUnpaidAction(
   collection: TransactionsCollection,
) {
   return createOptimisticAction<TransactionIdActionInput>({
      onMutate: ({ id }) => {
         collection.update(id, (draft) => {
            draft.status = "pending";
            draft.ignored = false;
            draft.paidAt = null;
         });
      },
      mutationFn: async ({ id }) => {
         const updated = await orpc.transactions.markAsUnpaid.call({ id });
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}

export function cancelTransactionAction(collection: TransactionsCollection) {
   return createOptimisticAction<TransactionIdActionInput>({
      onMutate: ({ id }) => {
         collection.update(id, (draft) => {
            draft.ignored = true;
         });
      },
      mutationFn: async ({ id }) => {
         const updated = await orpc.transactions.cancel.call({ id });
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}

export function reactivateTransactionAction(
   collection: TransactionsCollection,
) {
   return createOptimisticAction<TransactionIdActionInput>({
      onMutate: ({ id }) => {
         collection.update(id, (draft) => {
            draft.ignored = false;
         });
      },
      mutationFn: async ({ id }) => {
         const updated = await orpc.transactions.reactivate.call({ id });
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}

export function importTransactionsAction(collection: TransactionsCollection) {
   return createOptimisticAction<TransactionImportActionInput>({
      onMutate: ({ rows }) => {
         collection.insert(rows);
      },
      mutationFn: async ({ input }) => {
         const imported = await orpc.transactions.importBulk.call(input);
         await safeRefetchTransactions(collection);
         return imported;
      },
   });
}

export function acceptSuggestedTransactionCategoryAction(
   collection: TransactionsCollection,
) {
   return createOptimisticAction<TransactionIdActionInput>({
      onMutate: ({ id }) => {
         collection.update(id, (draft) => {
            draft.categoryId = draft.suggestedCategoryId;
            draft.categoryName = draft.suggestedCategoryName;
            draft.suggestedCategoryId = null;
            draft.suggestedCategoryName = null;
            draft.updatedAt = dayjs().toDate();
         });
      },
      mutationFn: async ({ id }) => {
         const updated = await orpc.transactions.acceptSuggestedCategory.call({
            id,
         });
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}

export function dismissSuggestedTransactionCategoryAction(
   collection: TransactionsCollection,
) {
   return createOptimisticAction<TransactionIdActionInput>({
      onMutate: ({ id }) => {
         collection.update(id, (draft) => {
            draft.suggestedCategoryId = null;
            draft.suggestedCategoryName = null;
            draft.updatedAt = dayjs().toDate();
         });
      },
      mutationFn: async ({ id }) => {
         const updated = await orpc.transactions.dismissSuggestedCategory.call({
            id,
         });
         await safeRefetchTransactions(collection);
         return updated;
      },
   });
}
