import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DefaultHeader } from "../-layout/default-header";
import { DataTableSkeleton } from "@/blocks/data-table/data-table-skeleton";
import { QueryBoundary } from "@/components/query-boundary";
import { TransactionsList } from "./-transactions/transactions-list";
import { buildTransactionColumns } from "./-transactions/transactions-columns";

const skeletonColumns = buildTransactionColumns();

const isoDateSearchParam = z
   .string()
   .regex(/^\d{4}-\d{2}-\d{2}$/)
   .catch("")
   .default("");

const transactionsSearchSchema = z.object({
   sorting: z
      .array(z.object({ id: z.string(), desc: z.boolean() }))
      .catch([])
      .default([]),
   columnFilters: z
      .array(z.object({ id: z.string(), value: z.unknown() }))
      .catch([])
      .default([]),
   page: z.number().int().min(1).catch(1).default(1),
   pageSize: z.number().int().min(1).max(100).catch(20).default(20),
   search: z.string().catch("").default(""),
   view: z
      .enum(["all", "payable", "receivable", "settled", "ignored"])
      .catch("all")
      .default("all"),
   overdueOnly: z.boolean().catch(false).default(false),
   status: z
      .array(z.enum(["pending", "paid"]))
      .catch([])
      .default([]),
   bankId: z.string().catch("").default(""),
   relationshipId: z.string().catch("").default(""),
   dateFrom: isoDateSearchParam,
   dateTo: isoDateSearchParam,
   grouping: z.array(z.string()).catch([]).default([]),
});

export const Route = createFileRoute(
   "/_authenticated/$slug/$teamSlug/_dashboard/transactions",
)({
   validateSearch: transactionsSearchSchema,
   ssr: false,
   pendingMs: 300,
   pendingComponent: () => (
      <main className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
         <DataTableSkeleton columns={skeletonColumns} />
      </main>
   ),
   head: () => ({
      meta: [{ title: "Lançamentos — Montte" }],
   }),
   component: TransactionsPage,
});

function TransactionsPage() {
   return (
      <main className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
         <DefaultHeader
            description="Gerencie receitas, despesas e transferências"
            title="Lançamentos"
         />
         <div className="flex flex-1 flex-col min-h-0">
            <QueryBoundary
               fallback={<DataTableSkeleton columns={skeletonColumns} />}
               errorTitle="Erro ao carregar lançamentos"
            >
               <TransactionsList />
            </QueryBoundary>
         </div>
      </main>
   );
}
