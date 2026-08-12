import { ScrollArea } from "@packages/ui/components/scroll-area";
import { SearchInput } from "@packages/ui/components/search-input";
import { Table } from "@packages/ui/components/table";
import { TooltipProvider } from "@packages/ui/components/tooltip";
import { Button } from "@packages/ui/components/button";
import { Calendar } from "@packages/ui/components/calendar";
import { Checkbox } from "@packages/ui/components/checkbox";
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from "@packages/ui/components/command";
import {
   Empty,
   EmptyDescription,
   EmptyHeader,
   EmptyMedia,
   EmptyTitle,
} from "@packages/ui/components/empty";
import {
   Popover,
   PopoverContent,
   PopoverTrigger,
} from "@packages/ui/components/popover";
import {
   SelectionActionButton,
   useTableBulkActions,
} from "@/hooks/use-selection-toolbar";
import {
   createCollection,
   eq,
   ilike,
   isNull,
   or,
   useLiveQuery,
} from "@tanstack/react-db";
import { getRouteApi } from "@tanstack/react-router";
import {
   getCoreRowModel,
   getExpandedRowModel,
   getGroupedRowModel,
   useReactTable,
   type ColumnDef,
   type ColumnFiltersState,
} from "@tanstack/react-table";
import dayjs from "dayjs";
import {
   ArrowLeftRight,
   Ban,
   CalendarDays,
   CheckCircle2,
   CircleDot,
   FileDown,
   FolderOpen,
   Landmark,
   Loader2,
   Plus,
   RotateCcw,
   Trash2,
   Undo2,
} from "lucide-react";
import { Result } from "better-result";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "@packages/ui/hooks/use-toast";
import { DataTableBody } from "@/blocks/data-table/data-table-body";
import { DataTableColumnVisibility } from "@/blocks/data-table/data-table-column-visibility";
import { DataTableFilterChips } from "@/blocks/data-table/data-table-filter-chips";
import { DataTableHeader } from "@/blocks/data-table/data-table-header";
import { DataTablePagination } from "@/blocks/data-table/data-table-pagination";
import { useDataTableLayout } from "@/blocks/data-table/use-data-table-layout";
import { useDebouncedSearch } from "@/blocks/data-table/use-debounced-search";
import { useTableUrlState } from "@/blocks/data-table/use-table-url-state";
import { DataImportButton } from "@/blocks/data-table/data-import/data-import-button";
import { DataImportSection } from "@/blocks/data-table/data-import/data-import-section";
import { ExportButton } from "@/components/export-button/export-button";
import { cn } from "@packages/ui/lib/utils";
import { useDataImport } from "@/blocks/data-table/data-import/use-data-import";
import type { DataImportConfig } from "@/blocks/data-table/data-import/use-data-import";
import { useSheet } from "@/hooks/use-sheet";
import { CategoryFormSheet } from "../-categories/category-form-sheet";
import { TransactionFormSheet } from "./transaction-form-sheet";
import { useCsvFile } from "@/hooks/use-csv-file";
import { useOfxFile } from "@/hooks/use-ofx-file";
import { useXlsxFile } from "@/hooks/use-xlsx-file";
import { useAlertDialog } from "@/hooks/use-alert-dialog";
import { useActiveTeam } from "@/hooks/use-active-team";
import type { Inputs } from "@/integrations/orpc/client";
import {
   bankAccountsCollectionOptions,
   buildOptimisticBankAccountRow,
   buildOptimisticBankAccountRowId,
   createBankAccountAction,
   type BankAccountCreateInput,
} from "@/integrations/tanstack-db/bank-accounts";
import {
   categoriesCollectionOptions,
   createCategoryAction,
   type CategoryCreateInput,
   type CategoriesCollectionRow,
} from "@/integrations/tanstack-db/categories";
import { creditCardsCollectionOptions } from "@/integrations/tanstack-db/credit-cards";
import {
   buildOptimisticRelationshipRow,
   buildOptimisticRelationshipRowId,
   createRelationshipAction,
   relationshipsCollectionOptions,
   type RelationshipCreateInput,
} from "@/integrations/tanstack-db/relationships";
import {
   buildOptimisticTransactionRow,
   buildOptimisticTransactionRowId,
   acceptSuggestedTransactionCategoryAction,
   bulkRemoveTransactionsAction,
   bulkUpdateTransactionsAction,
   cancelTransactionAction,
   createTransactionAction,
   dismissSuggestedTransactionCategoryAction,
   importTransactionsAction,
   markTransactionAsPaidAction,
   markTransactionAsUnpaidAction,
   reactivateTransactionAction,
   removeTransactionAction,
   transactionsCollectionOptions,
   transactionsPageInfoCollectionOptions,
   updateTransactionAction,
   type TransactionCreateInput,
} from "@/integrations/tanstack-db/transactions";
import {
   buildTransactionColumns,
   type BankAccountOption,
   type CategoryOption,
   type TransactionRow,
} from "./transactions-columns";
import { normalizeTransactionSorting } from "./transaction-sorting";

const routeApi = getRouteApi(
   "/_authenticated/$slug/$teamSlug/_dashboard/transactions",
);

type ImportLookupItem = { id: string; name: string };
type PaymentMethod = NonNullable<TransactionCreateInput["paymentMethod"]>;

type DateRangeFilterValue = { from?: string; to?: string };

function isDateRangeFilterValue(value: unknown): value is DateRangeFilterValue {
   return (
      typeof value === "object" &&
      value !== null &&
      ("from" in value || "to" in value)
   );
}

function isTransactionStatus(value: unknown): value is "pending" | "paid" {
   return value === "pending" || value === "paid";
}

function getStringColumnFilterValue(
   filters: ColumnFiltersState,
   id: string,
): string | undefined {
   const value = filters.find((filter) => filter.id === id)?.value;
   return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getDateRangeColumnFilterValue(
   filters: ColumnFiltersState,
   id: string,
) {
   const value = filters.find((filter) => filter.id === id)?.value;
   if (typeof value === "string" && value.trim()) {
      return { from: value.trim(), to: value.trim() };
   }
   if (!isDateRangeFilterValue(value)) return {};
   return {
      from: typeof value.from === "string" ? value.from : undefined,
      to: typeof value.to === "string" ? value.to : undefined,
   };
}

function normalizeImportLookup(value: unknown): string {
   return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
}

const IMPORT_HEADER_LABELS: Record<string, string> = {
   data: "Data",
   date: "Data",
   datetxn: "Data",
   pagamento: "Data",
   duedate: "Vencimento",
   valor: "Valor",
   amount: "Valor",
   name: "Nome",
   valorbr: "Valor",
   desc: "Nome",
   description: "Nome",
   descr: "Nome",
   memo: "Nome",
   detalhe: "Nome",
   tipo: "Tipo",
   type: "Tipo",
   despesareceita: "Tipo",
   status: "Status",
   conta: "Conta",
   bankaccountname: "Conta",
   bankaccount: "Conta",
   contaid: "Conta",
   banco: "Conta",
   cliente: "Cliente",
   fornecedor: "Fornecedor",
   cartao: "Cartão",
   formapagamento: "Forma de pagamento",
   formadepagamento: "Forma de pagamento",
   paymentmethod: "Forma de pagamento",
   payment: "Forma de pagamento",
   card: "Cartão",
   creditcard: "Cartão",
   creditcardname: "Cartão",
   categoria: "Categoria",
   category: "Categoria",
   categoryname: "Categoria",
   categoriaid: "Categoria",
   vencimento: "Vencimento",
   contaareceberrs: "Conta a receber",
   contaapagarrs: "Conta a pagar",
   saldors: "Saldo",
   fitid: "Identificador",
   reference: "Referência",
};

function normalizeImportHeader(value: string): string {
   const normalized = normalizeImportLookup(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
   return (IMPORT_HEADER_LABELS[normalized] ?? value.trim()) || "";
}

function localizeImportHeaders<T extends { headers: string[] }>(result: T): T {
   return {
      ...result,
      headers: result.headers.map(normalizeImportHeader),
   };
}

function resolveImportId(
   options: ImportLookupItem[],
   value: unknown,
): string | null {
   const normalized = normalizeImportLookup(value);
   if (!normalized) return null;
   const option = options.find(
      (item) =>
         normalizeImportLookup(item.id) === normalized ||
         normalizeImportLookup(item.name) === normalized,
   );
   return option?.id ?? null;
}

function parseImportDate(value: unknown): string {
   if (value instanceof Date) {
      return dayjs(value).isValid() ? dayjs(value).format("YYYY-MM-DD") : "";
   }
   const raw = String(value ?? "").trim();
   if (!raw) return "";
   const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
   if (slash) {
      const day = Number.parseInt(slash[1], 10);
      const month = Number.parseInt(slash[2], 10);
      const year = Number.parseInt(slash[3], 10);
      const monthStart = dayjs(`${slash[3]}-${slash[2].padStart(2, "0")}-01`);
      if (
         month < 1 ||
         month > 12 ||
         day < 1 ||
         day > monthStart.daysInMonth()
      ) {
         return "";
      }
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
   }
   if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
   if (/^\d+(\.\d+)?$/.test(raw)) {
      const serial = Number.parseFloat(raw);
      const fromSerial = dayjs("1899-12-30").add(Math.trunc(serial), "day");
      if (fromSerial.isValid()) return fromSerial.format("YYYY-MM-DD");
   }
   return raw;
}

function parseImportAmount(value: unknown) {
   const cleaned = String(value ?? "")
      .replace(/[R$\s]/g, "")
      .trim();
   const raw = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
   const parsed = Number.parseFloat(raw);
   if (Number.isNaN(parsed)) return { amount: "", signedAmount: 0 };
   return { amount: Math.abs(parsed).toFixed(2), signedAmount: parsed };
}

function parseImportType(
   value: unknown,
   signedAmount: number,
): "income" | "expense" {
   const normalized = normalizeImportLookup(value);
   if (
      normalized === "income" ||
      normalized.includes("cred") ||
      normalized.includes("entrada") ||
      normalized.includes("receita")
   ) {
      return "income";
   }
   if (
      normalized === "expense" ||
      normalized.includes("deb") ||
      normalized.includes("saida") ||
      normalized.includes("despesa")
   ) {
      return "expense";
   }
   return signedAmount < 0 ? "expense" : "income";
}

function cleanImportText(value: unknown): string {
   const text = String(value ?? "").trim();
   return text === "-" ? "" : text;
}

function parseImportPaymentMethod(value: unknown): PaymentMethod | null {
   const normalized = normalizeImportLookup(value);
   if (!normalized) return null;
   if (normalized === "pix") return "pix";
   if (normalized.includes("credito") || normalized.includes("crédito")) {
      return "credit_card";
   }
   if (normalized.includes("debito") || normalized.includes("débito")) {
      if (
         normalized.includes("automatico") ||
         normalized.includes("automático")
      ) {
         return "automatic_debit";
      }
      return "debit_card";
   }
   if (normalized.includes("boleto")) return "boleto";
   if (normalized.includes("dinheiro") || normalized.includes("cash")) {
      return "cash";
   }
   if (normalized.includes("transfer")) return "transfer";
   if (normalized.includes("cheque")) return "cheque";
   if (normalized.includes("outro") || normalized.includes("other")) {
      return "other";
   }
   return null;
}

function parseImportStatus(value: unknown): {
   status: "pending" | "paid";
   ignored: boolean;
} {
   const normalized = normalizeImportLookup(value);
   if (
      normalized === "cancelled" ||
      normalized.includes("cancelado") ||
      normalized.includes("ignorado")
   ) {
      return { status: "pending", ignored: true };
   }
   const isNegativePaid =
      /\bnao\s+(pago|efetivado)\b/.test(normalized) ||
      /\bnão\s+(pago|efetivado)\b/.test(normalized);
   if (
      !isNegativePaid &&
      (normalized === "paid" ||
         /\befetivado\b/.test(normalized) ||
         /\bpago\b/.test(normalized))
   ) {
      return { status: "paid", ignored: false };
   }
   return { status: "pending", ignored: false };
}

function getErrorMessage(error: unknown, fallback: string) {
   if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.length > 0
   ) {
      return error.message;
   }
   return fallback;
}

function escapeIlikePattern(value: string) {
   return value
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
}

function buildInlineCategoryRow({
   id,
   name,
   teamId,
}: {
   id: string;
   name: string;
   teamId: string;
}): CategoriesCollectionRow {
   const now = dayjs().toDate();
   return {
      id,
      teamId,
      parentId: null,
      name,
      type: "expense",
      level: 0,
      description: null,
      isDefault: false,
      color: null,
      icon: null,
      isArchived: false,
      notes: null,
      participatesDre: true,
      dreGroupId: null,
      createdAt: now,
      updatedAt: now,
   };
}

function getColumnDefId(column: ColumnDef<TransactionRow>): string | null {
   if (column.id) return column.id;
   if ("accessorKey" in column && typeof column.accessorKey === "string") {
      return column.accessorKey;
   }
   return null;
}

function normalizeTransactionsColumnOrder(
   order: string[] | undefined,
   defaultOrder: string[],
): string[] {
   const known = new Set(defaultOrder);
   const middle = (order ?? []).filter(
      (id) => known.has(id) && id !== "__select" && id !== "__actions",
   );

   const ensureBefore = (id: string, beforeId: string) => {
      const currentIndex = middle.indexOf(id);
      if (currentIndex >= 0) middle.splice(currentIndex, 1);
      const beforeIndex = middle.indexOf(beforeId);
      if (beforeIndex >= 0) {
         middle.splice(beforeIndex, 0, id);
         return;
      }
      middle.push(id);
   };

   ensureBefore("customerName", "bankAccountName");
   ensureBefore("supplierName", "bankAccountName");

   for (const id of defaultOrder) {
      if (id !== "__select" && id !== "__actions" && !middle.includes(id)) {
         middle.push(id);
      }
   }

   return ["__select", ...middle, "__actions"];
}

export function TransactionsList() {
   const navigate = routeApi.useNavigate();
   const { publicEnv, queryClient } = routeApi.useRouteContext();
   const {
      sorting,
      columnFilters,
      page,
      pageSize,
      status,
      search,
      bankId,
      dateFrom,
      dateTo,
      relationshipId,
   } = routeApi.useSearch();

   const { openAlertDialog } = useAlertDialog();
   const { openSheet } = useSheet();
   const { activeTeamId } = useActiveTeam();
   const { parse: parseCsv, generate: generateCsv } = useCsvFile();
   const { parse: parseXlsx, generate: generateXlsx } = useXlsxFile();
   const { parse: parseOfx } = useOfxFile();
   const layout = useDataTableLayout("transactions");
   const [isExportingPdf, setIsExportingPdf] = useState(false);

   const searchInput = useDebouncedSearch({
      value: search,
      onCommit: (value) =>
         navigate({
            search: (prev) => ({ ...prev, search: value, page: 1 }),
            replace: true,
         }),
   });

   const trimmedSearch = search.trim();
   const columnStatusFilter = columnFilters.find(
      (filter) => filter.id === "status",
   )?.value;
   const statusFromColumn = isTransactionStatus(columnStatusFilter)
      ? columnStatusFilter
      : undefined;
   const effectiveStatus = useMemo<Array<"pending" | "paid">>(() => {
      if (statusFromColumn) return [statusFromColumn];
      return status.filter(isTransactionStatus);
   }, [status, statusFromColumn]);
   const effectiveBankId =
      getStringColumnFilterValue(columnFilters, "bankAccountName") ?? bankId;
   const effectiveRelationshipId =
      getStringColumnFilterValue(columnFilters, "customerName") ??
      getStringColumnFilterValue(columnFilters, "supplierName") ??
      relationshipId;
   const dateRangeFilter = getDateRangeColumnFilterValue(columnFilters, "date");
   const dueDateRangeFilter = getDateRangeColumnFilterValue(
      columnFilters,
      "dueDate",
   );
   const nameFilterValue = getStringColumnFilterValue(columnFilters, "name");
   const typeFilterValue = columnFilters.find(
      (filter) => filter.id === "type",
   )?.value;
   const effectiveType =
      typeFilterValue === "income" ||
      typeFilterValue === "expense" ||
      typeFilterValue === "transfer"
         ? typeFilterValue
         : undefined;
   const paymentMethodFilterValue = columnFilters.find(
      (filter) => filter.id === "paymentMethod",
   )?.value;
   const effectivePaymentMethod =
      typeof paymentMethodFilterValue === "string"
         ? paymentMethodFilterValue
         : undefined;
   const effectiveDateFrom = dateRangeFilter.from ?? dateFrom;
   const effectiveDateTo = dateRangeFilter.to ?? dateTo;
   const collectionTeamId = activeTeamId ?? "no-team";
   const transactionsCollection = useMemo(
      () =>
         createCollection(
            transactionsCollectionOptions({
               queryClient,
               teamId: collectionTeamId,
               page,
               pageSize,
               search: trimmedSearch || undefined,
               view: "all",
               overdueOnly: false,
               status: effectiveStatus.length > 0 ? effectiveStatus : undefined,
               bankAccountId: effectiveBankId || undefined,
               dateFrom: effectiveDateFrom || undefined,
               dateTo: effectiveDateTo || undefined,
               dueDateFrom: dueDateRangeFilter.from,
               dueDateTo: dueDateRangeFilter.to,
               relationshipId: effectiveRelationshipId || undefined,
            }),
         ),
      [
         collectionTeamId,
         page,
         pageSize,
         dueDateRangeFilter.from,
         dueDateRangeFilter.to,
         effectiveDateFrom,
         effectiveDateTo,
         effectiveBankId,
         effectiveRelationshipId,
         effectiveStatus,
         queryClient,
         trimmedSearch,
      ],
   );

   const transactionsPageInfoCollection = useMemo(
      () =>
         createCollection(
            transactionsPageInfoCollectionOptions({
               queryClient,
               teamId: collectionTeamId,
               search: trimmedSearch || undefined,
               view: "all",
               overdueOnly: false,
               status: effectiveStatus.length > 0 ? effectiveStatus : undefined,
               bankAccountId: effectiveBankId || undefined,
               dateFrom: effectiveDateFrom || undefined,
               dateTo: effectiveDateTo || undefined,
               dueDateFrom: dueDateRangeFilter.from,
               dueDateTo: dueDateRangeFilter.to,
               relationshipId: effectiveRelationshipId || undefined,
            }),
         ),
      [
         collectionTeamId,
         dueDateRangeFilter.from,
         dueDateRangeFilter.to,
         effectiveDateFrom,
         effectiveDateTo,
         effectiveBankId,
         effectiveRelationshipId,
         effectiveStatus,
         queryClient,
         trimmedSearch,
      ],
   );

   const bankAccountsCollection = useMemo(
      () =>
         createCollection(
            bankAccountsCollectionOptions({
               queryClient,
               teamId: collectionTeamId,
            }),
         ),
      [collectionTeamId, queryClient],
   );

   const categoriesCollection = useMemo(
      () =>
         createCollection(
            categoriesCollectionOptions({
               queryClient,
               teamId: collectionTeamId,
            }),
         ),
      [collectionTeamId, queryClient],
   );

   const creditCardsCollection = useMemo(
      () =>
         createCollection(
            creditCardsCollectionOptions({
               queryClient,
               teamId: collectionTeamId,
            }),
         ),
      [collectionTeamId, queryClient],
   );

   const customersCollection = useMemo(
      () =>
         createCollection(
            relationshipsCollectionOptions({
               queryClient,
               teamId: collectionTeamId,
               role: "customer",
               archived: false,
            }),
         ),
      [collectionTeamId, queryClient],
   );

   const suppliersCollection = useMemo(
      () =>
         createCollection(
            relationshipsCollectionOptions({
               queryClient,
               teamId: collectionTeamId,
               role: "supplier",
               archived: false,
            }),
         ),
      [collectionTeamId, queryClient],
   );

   const { data: liveTransactions } = useLiveQuery(
      (q) => {
         let query = q.from({ transaction: transactionsCollection });

         const selectedStatuses = effectiveStatus.filter(
            (selectedStatus) => selectedStatus !== undefined,
         );
         if (selectedStatuses.length === 1) {
            const firstStatus = selectedStatuses[0];
            if (firstStatus) {
               query = query.where(({ transaction }) =>
                  eq(transaction.status, firstStatus),
               );
            }
         }
         if (selectedStatuses.length > 1) {
            const [firstStatus, secondStatus, ...remainingStatuses] =
               selectedStatuses;
            if (firstStatus && secondStatus) {
               query = query.where(({ transaction }) => {
                  let statusFilter = or(
                     eq(transaction.status, firstStatus),
                     eq(transaction.status, secondStatus),
                  );
                  for (const selectedStatus of remainingStatuses) {
                     statusFilter = or(
                        statusFilter,
                        eq(transaction.status, selectedStatus),
                     );
                  }
                  return statusFilter;
               });
            }
         }
         if (effectiveBankId) {
            query = query.where(({ transaction }) =>
               eq(transaction.bankAccountId, effectiveBankId),
            );
         }
         if (effectiveRelationshipId) {
            query = query.where(({ transaction }) =>
               eq(transaction.relationshipId, effectiveRelationshipId),
            );
         }
         if (trimmedSearch) {
            const pattern = `%${escapeIlikePattern(trimmedSearch)}%`;
            query = query.where(({ transaction }) =>
               or(
                  ilike(transaction.name, pattern),
                  ilike(transaction.description, pattern),
               ),
            );
         }

         if (nameFilterValue) {
            query = query.where(({ transaction }) =>
               ilike(
                  transaction.name,
                  `%${escapeIlikePattern(nameFilterValue)}%`,
               ),
            );
         }

         if (effectiveType) {
            query = query.where(({ transaction }) =>
               eq(transaction.type, effectiveType),
            );
         }

         if (effectivePaymentMethod === "__none") {
            query = query.where(({ transaction }) =>
               isNull(transaction.paymentMethod),
            );
         }
         if (effectivePaymentMethod && effectivePaymentMethod !== "__none") {
            query = query.where(({ transaction }) =>
               eq(transaction.paymentMethod, effectivePaymentMethod),
            );
         }

         const normalizedSorting = normalizeTransactionSorting(sorting);
         if (normalizedSorting.length > 0) {
            for (const rule of normalizedSorting) {
               switch (rule.id) {
                  case "amount":
                     query = query.orderBy(
                        ({ transaction }) => transaction.amount,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "bankAccountName":
                     query = query.orderBy(
                        ({ transaction }) => transaction.bankAccountName,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "categoryName":
                     query = query.orderBy(
                        ({ transaction }) => transaction.categoryName,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "creditCardName":
                     query = query.orderBy(
                        ({ transaction }) => transaction.creditCardName,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "date":
                     query = query.orderBy(
                        ({ transaction }) => transaction.date,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "dueDate":
                     query = query.orderBy(
                        ({ transaction }) => transaction.dueDate,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "name":
                     query = query.orderBy(
                        ({ transaction }) => transaction.name,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "paymentMethod":
                     query = query.orderBy(
                        ({ transaction }) => transaction.paymentMethod,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "relationshipName":
                     query = query.orderBy(
                        ({ transaction }) => transaction.relationshipName,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "status":
                     query = query.orderBy(
                        ({ transaction }) => transaction.status,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
                  case "type":
                     query = query.orderBy(
                        ({ transaction }) => transaction.type,
                        rule.desc ? "desc" : "asc",
                     );
                     break;
               }
            }
         } else {
            query = query
               .orderBy(({ transaction }) => transaction.date, "desc")
               .orderBy(({ transaction }) => transaction.createdAt, "desc");
         }

         return query.limit(pageSize).select(({ transaction }) => transaction);
      },
      [
         effectiveBankId,
         effectiveRelationshipId,
         page,
         pageSize,
         columnFilters,
         effectivePaymentMethod,
         effectiveStatus,
         effectiveType,
         nameFilterValue,
         sorting,
         transactionsCollection,
         trimmedSearch,
      ],
   );

   const { data: pageInfoRows } = useLiveQuery(
      (q) =>
         q
            .from({ pageInfo: transactionsPageInfoCollection })
            .select(({ pageInfo }) => pageInfo),
      [transactionsPageInfoCollection],
   );

   const { data: bankAccounts } = useLiveQuery(
      (q) =>
         q
            .from({ bankAccount: bankAccountsCollection })
            .select(({ bankAccount }) => bankAccount),
      [bankAccountsCollection],
   );

   const { data: categoriesResult } = useLiveQuery(
      (q) =>
         q
            .from({ category: categoriesCollection })
            .where(({ category }) => eq(category.isArchived, false))
            .select(({ category }) => category),
      [categoriesCollection],
   );

   const { data: creditCardsResult } = useLiveQuery(
      (q) =>
         q
            .from({ creditCard: creditCardsCollection })
            .where(({ creditCard }) => eq(creditCard.status, "active"))
            .select(({ creditCard }) => creditCard),
      [creditCardsCollection],
   );

   const { data: customersResult } = useLiveQuery(
      (q) =>
         q
            .from({ customer: customersCollection })
            .select(({ customer }) => customer),
      [customersCollection],
   );

   const { data: suppliersResult } = useLiveQuery(
      (q) =>
         q
            .from({ supplier: suppliersCollection })
            .select(({ supplier }) => supplier),
      [suppliersCollection],
   );

   const safeTransactions = useMemo(
      () => liveTransactions ?? [],
      [liveTransactions],
   );
   const safeBankAccounts = useMemo(() => bankAccounts ?? [], [bankAccounts]);
   const safeCategories = useMemo(
      () => categoriesResult ?? [],
      [categoriesResult],
   );
   const safeCreditCards = useMemo(
      () => creditCardsResult ?? [],
      [creditCardsResult],
   );
   const safeCustomers = useMemo(
      () => customersResult ?? [],
      [customersResult],
   );
   const safeSuppliers = useMemo(
      () => suppliersResult ?? [],
      [suppliersResult],
   );

   const transactionData = safeTransactions;
   const isTransactionsLoaded = liveTransactions !== undefined;
   const total = pageInfoRows?.[0]?.total ?? 0;

   const transactionsPdfInput = useMemo<Inputs["transactions"]["getAll"]>(
      () => ({
         search: trimmedSearch || undefined,
         view: "all",
         overdueOnly: false,
         status: effectiveStatus.length > 0 ? effectiveStatus : undefined,
         bankAccountId: effectiveBankId || undefined,
         relationshipId: effectiveRelationshipId || undefined,
         dateFrom: effectiveDateFrom || undefined,
         dateTo: effectiveDateTo || undefined,
         dueDateFrom: dueDateRangeFilter.from,
         dueDateTo: dueDateRangeFilter.to,
         type: effectiveType,
         paymentMethod:
            effectivePaymentMethod && effectivePaymentMethod !== "__none"
               ? effectivePaymentMethod
               : undefined,
         all: true,
         sorting:
            normalizeTransactionSorting(sorting).length > 0
               ? normalizeTransactionSorting(sorting)
               : [{ id: "date", desc: true }],
      }),
      [
         dueDateRangeFilter.from,
         dueDateRangeFilter.to,
         effectiveBankId,
         effectiveDateFrom,
         effectiveDateTo,
         effectivePaymentMethod,
         effectiveRelationshipId,
         effectiveStatus,
         effectiveType,
         sorting,
         trimmedSearch,
      ],
   );

   const transactionsPdfFilters = useMemo(() => {
      const labels: string[] = [];
      if (effectiveDateFrom || effectiveDateTo) {
         labels.push(
            `Data: ${effectiveDateFrom ? dayjs(effectiveDateFrom).format("DD/MM/YYYY") : "início"} — ${effectiveDateTo ? dayjs(effectiveDateTo).format("DD/MM/YYYY") : "hoje"}`,
         );
      }
      if (dueDateRangeFilter.from || dueDateRangeFilter.to) {
         labels.push(
            `Vencimento: ${dueDateRangeFilter.from ? dayjs(dueDateRangeFilter.from).format("DD/MM/YYYY") : "início"} — ${dueDateRangeFilter.to ? dayjs(dueDateRangeFilter.to).format("DD/MM/YYYY") : "hoje"}`,
         );
      }
      if (trimmedSearch) labels.push(`Busca: ${trimmedSearch}`);
      if (nameFilterValue) labels.push(`Lançamento: ${nameFilterValue}`);
      if (effectiveStatus.length > 0) {
         labels.push(
            `Status: ${effectiveStatus
               .map((item) => (item === "paid" ? "Realizado" : "Planejado"))
               .join(", ")}`,
         );
      }
      if (effectiveType) {
         labels.push(
            `Tipo: ${
               effectiveType === "income"
                  ? "Receita"
                  : effectiveType === "expense"
                    ? "Despesa"
                    : "Transferência"
            }`,
         );
      }
      if (effectivePaymentMethod) {
         labels.push(
            `Forma: ${effectivePaymentMethod === "__none" ? "Sem forma de pagamento" : effectivePaymentMethod}`,
         );
      }
      if (effectiveBankId) {
         labels.push(
            `Conta: ${
               safeBankAccounts.find(
                  (account) => account.id === effectiveBankId,
               )?.name ?? effectiveBankId
            }`,
         );
      }
      if (effectiveRelationshipId) {
         const relationship = [...safeCustomers, ...safeSuppliers].find(
            (item) => item.id === effectiveRelationshipId,
         );
         labels.push(
            `Contato: ${relationship?.name ?? effectiveRelationshipId}`,
         );
      }
      return labels;
   }, [
      dueDateRangeFilter.from,
      dueDateRangeFilter.to,
      effectiveBankId,
      effectiveDateFrom,
      effectiveDateTo,
      effectivePaymentMethod,
      effectiveRelationshipId,
      effectiveStatus,
      effectiveType,
      nameFilterValue,
      safeBankAccounts,
      safeCustomers,
      safeSuppliers,
      trimmedSearch,
   ]);

   const handleExportPdf = useCallback(() => {
      setIsExportingPdf(true);
      import("./transactions-pdf")
         .then(({ downloadTransactionsPdf }) =>
            downloadTransactionsPdf({
               input: transactionsPdfInput,
               filters: transactionsPdfFilters,
               localFilters: {
                  name: nameFilterValue,
                  paymentMethod: effectivePaymentMethod,
                  type: effectiveType,
               },
            }),
         )
         .then(() => toast.success("PDF exportado."))
         .catch(() => toast.error("Não foi possível exportar o PDF."))
         .finally(() => setIsExportingPdf(false));
   }, [
      effectivePaymentMethod,
      effectiveType,
      nameFilterValue,
      transactionsPdfFilters,
      transactionsPdfInput,
   ]);

   const handleUpdate = useCallback(
      async (id: string, patch: Record<string, unknown>) => {
         const update = updateTransactionAction(transactionsCollection);
         const transaction = update({ id, patch });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao atualizar lançamento."),
            );
         }
      },
      [transactionsCollection],
   );

   const handleCreateBankAccount = useCallback(
      async (name: string): Promise<string> => {
         if (!activeTeamId) {
            toast.error("Time ativo não encontrado.");
            return "";
         }
         const input: BankAccountCreateInput = {
            name,
            type: "checking",
         };
         const createBankAccount = createBankAccountAction(
            bankAccountsCollection,
         );
         const transaction = createBankAccount({
            row: buildOptimisticBankAccountRow({
               id: buildOptimisticBankAccountRowId(),
               input,
               teamId: activeTeamId,
            }),
            input,
         });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao criar conta bancária."),
            );
            return "";
         }
         return result.value.id;
      },
      [activeTeamId, bankAccountsCollection],
   );

   const handleCreateCategory = useCallback(
      async (name: string): Promise<string> => {
         if (!activeTeamId) {
            toast.error("Time ativo não encontrado.");
            return "";
         }
         const input: CategoryCreateInput = {
            name,
            type: "expense",
         };
         const id = buildOptimisticTransactionRowId("__category_");
         const createCategory = createCategoryAction(categoriesCollection);
         const transaction = createCategory({
            row: buildInlineCategoryRow({ id, name, teamId: activeTeamId }),
            input,
         });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao criar categoria."),
            );
            return "";
         }
         return result.value.id;
      },
      [activeTeamId, categoriesCollection],
   );

   const handleCreateCustomer = useCallback(
      async (name: string): Promise<string> => {
         if (!activeTeamId) {
            toast.error("Time ativo não encontrado.");
            return "";
         }
         const input: RelationshipCreateInput = {
            name,
            role: "customer",
            kind: "company",
            documentNumber: null,
            email: null,
            phone: null,
         };
         const createCustomer = createRelationshipAction(customersCollection);
         const transaction = createCustomer({
            row: buildOptimisticRelationshipRow({
               id: buildOptimisticRelationshipRowId(),
               input,
               teamId: activeTeamId,
            }),
            input,
         });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao criar cliente."),
            );
            return "";
         }
         return result.value.id;
      },
      [activeTeamId, customersCollection],
   );

   const handleCreateSupplier = useCallback(
      async (name: string): Promise<string> => {
         if (!activeTeamId) {
            toast.error("Time ativo não encontrado.");
            return "";
         }
         const input: RelationshipCreateInput = {
            name,
            role: "supplier",
            kind: "company",
            documentNumber: null,
            email: null,
            phone: null,
         };
         const createSupplier = createRelationshipAction(suppliersCollection);
         const transaction = createSupplier({
            row: buildOptimisticRelationshipRow({
               id: buildOptimisticRelationshipRowId(),
               input,
               teamId: activeTeamId,
            }),
            input,
         });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao criar fornecedor."),
            );
            return "";
         }
         return result.value.id;
      },
      [activeTeamId, suppliersCollection],
   );

   const handleCreateTransaction = useCallback(
      async (input: TransactionCreateInput) => {
         if (!activeTeamId) {
            toast.error("Time ativo não encontrado.");
            return false;
         }
         const createTransaction = createTransactionAction(
            transactionsCollection,
         );
         const transaction = createTransaction({
            row: buildOptimisticTransactionRow({
               id: buildOptimisticTransactionRowId(),
               input,
               teamId: activeTeamId,
               bankAccountName:
                  safeBankAccounts.find(
                     (account) => account.id === input.bankAccountId,
                  )?.name ?? null,
               categoryName:
                  safeCategories.find(
                     (category) => category.id === input.categoryId,
                  )?.name ?? null,
               creditCardName:
                  safeCreditCards.find((card) => card.id === input.creditCardId)
                     ?.name ?? null,
               relationshipName:
                  safeCustomers.find(
                     (customer) => customer.id === input.relationshipId,
                  )?.name ??
                  safeSuppliers.find(
                     (supplier) => supplier.id === input.relationshipId,
                  )?.name ??
                  null,
            }),
            input,
         });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao criar lançamento."),
            );
            return false;
         }
         return true;
      },
      [
         activeTeamId,
         safeBankAccounts,
         safeCategories,
         safeCreditCards,
         safeCustomers,
         safeSuppliers,
         transactionsCollection,
      ],
   );

   const handleCreate = useCallback(() => {
      openSheet({
         renderChildren: () => (
            <TransactionFormSheet
               bankAccounts={safeBankAccounts}
               categories={safeCategories}
               onCreate={handleCreateTransaction}
               onCreateCategory={({ type, name, onCreated }) => {
                  openSheet({
                     renderChildren: () => (
                        <CategoryFormSheet
                           categories={safeCategories}
                           collection={categoriesCollection}
                           teamId={activeTeamId}
                           defaultType={type}
                           defaultName={name}
                           onCreated={onCreated}
                        />
                     ),
                  });
               }}
            />
         ),
      });
   }, [
      activeTeamId,
      categoriesCollection,
      handleCreateTransaction,
      openSheet,
      safeBankAccounts,
      safeCategories,
   ]);

   const handleDelete = useCallback(
      (transaction: TransactionRow) => {
         openAlertDialog({
            title: "Excluir lançamento",
            description:
               "Tem certeza que deseja excluir este lançamento? Esta ação não pode ser desfeita.",
            actionLabel: "Excluir",
            cancelLabel: "Cancelar",
            variant: "destructive",
            onAction: async () => {
               const remove = removeTransactionAction(transactionsCollection);
               const result = await Result.tryPromise({
                  try: () => remove({ id: transaction.id }).isPersisted.promise,
                  catch: (error) => error,
               });
               if (Result.isError(result)) {
                  toast.error(
                     getErrorMessage(
                        result.error,
                        "Erro ao excluir lançamento.",
                     ),
                  );
                  return;
               }
               toast.success("Lançamento excluído com sucesso.");
            },
         });
      },
      [openAlertDialog, transactionsCollection],
   );

   const handleMarkPaid = useCallback(
      async (tx: TransactionRow) => {
         const markAsPaid = markTransactionAsPaidAction(transactionsCollection);
         const transaction = markAsPaid({
            id: tx.id,
            paidDate: dayjs().format("YYYY-MM-DD"),
         });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao marcar como pago."),
            );
            return;
         }
         toast.success("Lançamento marcado como pago.");
      },
      [transactionsCollection],
   );

   const handleMarkUnpaid = useCallback(
      async (tx: TransactionRow) => {
         const markAsUnpaid = markTransactionAsUnpaidAction(
            transactionsCollection,
         );
         const transaction = markAsUnpaid({ id: tx.id });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao desmarcar pagamento."),
            );
            return;
         }
         toast.success("Pagamento desmarcado.");
      },
      [transactionsCollection],
   );

   const handleCancel = useCallback(
      (tx: TransactionRow) => {
         openAlertDialog({
            title: "Ignorar lançamento",
            description:
               "Tem certeza que deseja ignorar este lançamento? Ele não entrará nos cálculos financeiros.",
            actionLabel: "Ignorar lançamento",
            cancelLabel: "Voltar",
            variant: "destructive",
            onAction: async () => {
               const cancel = cancelTransactionAction(transactionsCollection);
               const result = await Result.tryPromise({
                  try: () => cancel({ id: tx.id }).isPersisted.promise,
                  catch: (error) => error,
               });
               if (Result.isError(result)) {
                  toast.error(
                     getErrorMessage(
                        result.error,
                        "Erro ao ignorar lançamento.",
                     ),
                  );
                  return;
               }
               toast.success("Lançamento ignorado.");
            },
         });
      },
      [openAlertDialog, transactionsCollection],
   );

   const handleReactivate = useCallback(
      async (tx: TransactionRow) => {
         const reactivate = reactivateTransactionAction(transactionsCollection);
         const transaction = reactivate({ id: tx.id });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao reativar lançamento."),
            );
            return;
         }
         toast.success("Lançamento reativado.");
      },
      [transactionsCollection],
   );

   const handleAcceptSuggestedCategory = useCallback(
      async (id: string) => {
         const accept = acceptSuggestedTransactionCategoryAction(
            transactionsCollection,
         );
         const transaction = accept({ id });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao aplicar sugestão."),
            );
            return;
         }
         toast.success("Categoria aplicada.");
      },
      [transactionsCollection],
   );

   const handleDismissSuggestedCategory = useCallback(
      async (id: string) => {
         const dismiss = dismissSuggestedTransactionCategoryAction(
            transactionsCollection,
         );
         const transaction = dismiss({ id });
         const result = await Result.tryPromise({
            try: () => transaction.isPersisted.promise,
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao ignorar sugestão."),
            );
            return;
         }
         toast.success("Sugestão ignorada.");
      },
      [transactionsCollection],
   );

   const importConfig: DataImportConfig = useMemo(
      () => ({
         importColumns: [
            { key: "receivableAmount", label: "Conta a receber" },
            { key: "payableAmount", label: "Conta a pagar" },
         ],
         accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
               [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
            "application/x-ofx": [".ofx"],
         },
         parseFile: async (file: File) => {
            const ext = file.name.split(".").pop()?.toLowerCase();
            if (ext === "ofx") {
               const parsed = await parseOfx(file);
               return localizeImportHeaders(parsed);
            }
            if (ext === "xlsx" || ext === "xls") {
               const parsed = await parseXlsx(file);
               return localizeImportHeaders(parsed);
            }
            const parsed = await parseCsv(file);
            return localizeImportHeaders(parsed);
         },
         mapRow: (row, i) => {
            const receivableAmount = String(row.receivableAmount ?? "").trim();
            const payableAmount = String(row.payableAmount ?? "").trim();
            const amountSource = (() => {
               if (receivableAmount) return receivableAmount;
               if (payableAmount) return payableAmount;
               return row.amount;
            })();
            const parsedAmount = parseImportAmount(amountSource);
            const type = receivableAmount
               ? "income"
               : payableAmount
                 ? "expense"
                 : parseImportType(row.type, parsedAmount.signedAmount);
            const parsedStatus = parseImportStatus(row.status);

            return {
               id: `__import_${i}`,
               date: parseImportDate(row.date) || parseImportDate(row.dueDate),
               amount: parsedAmount.amount,
               type,
               name: cleanImportText(row.name) || null,
               status: parsedStatus.status,
               ignored: parsedStatus.ignored,
               dueDate: row.dueDate ? parseImportDate(row.dueDate) : null,
               bankAccountName: cleanImportText(row.bankAccountName),
               bankAccountId: resolveImportId(
                  safeBankAccounts,
                  row.bankAccountName,
               ),
               customerName: cleanImportText(row.customerName),
               supplierName: cleanImportText(row.supplierName),
               relationshipName:
                  type === "income"
                     ? cleanImportText(row.customerName)
                     : cleanImportText(row.supplierName),
               relationshipId:
                  type === "income"
                     ? resolveImportId(safeCustomers, row.customerName)
                     : resolveImportId(safeSuppliers, row.supplierName),
               categoryName: cleanImportText(row.categoryName),
               categoryId: resolveImportId(safeCategories, row.categoryName),
               creditCardName: cleanImportText(row.creditCardName),
               creditCardId: resolveImportId(
                  safeCreditCards,
                  row.creditCardName,
               ),
               paymentMethod: parseImportPaymentMethod(row.paymentMethod),
               suggestedCategoryId: null,
               suggestedCategoryName: null,
            };
         },
         template: {
            label: "Baixar modelo",
            description:
               "Inclui Data, Nome, Tipo, Valor, Status e referências por nome. A categoria é obrigatória.",
            formats: [
               {
                  filename: "modelo-lancamentos.csv",
                  label: "CSV",
                  createBlob: () =>
                     generateCsv(
                        [
                           {
                              Data: dayjs().format("YYYY-MM-DD"),
                              Nome: "Venda recebida",
                              Tipo: "Receita",
                              Valor: "1500.00",
                              Status: "Efetivado",
                              "Forma de pagamento": "Pix",
                              Vencimento: "",
                              Conta: safeBankAccounts[0]?.name ?? "",
                              Cartão: "",
                              Categoria: safeCategories[0]?.name ?? "",
                           },
                        ],
                        [
                           "Data",
                           "Nome",
                           "Tipo",
                           "Valor",
                           "Status",
                           "Forma de pagamento",
                           "Vencimento",
                           "Conta",
                           "Cartão",
                           "Categoria",
                        ],
                     ),
               },
               {
                  filename: "modelo-lancamentos.xlsx",
                  label: "XLSX",
                  createBlob: () =>
                     generateXlsx(
                        [
                           {
                              Data: dayjs().format("YYYY-MM-DD"),
                              Nome: "Venda recebida",
                              Tipo: "Receita",
                              Valor: "1500.00",
                              Status: "Efetivado",
                              "Forma de pagamento": "Pix",
                              Vencimento: "",
                              Conta: safeBankAccounts[0]?.name ?? "",
                              Cartão: "",
                              Categoria: safeCategories[0]?.name ?? "",
                           },
                        ],
                        [
                           "Data",
                           "Nome",
                           "Tipo",
                           "Valor",
                           "Status",
                           "Forma de pagamento",
                           "Vencimento",
                           "Conta",
                           "Cartão",
                           "Categoria",
                        ],
                     ),
               },
            ],
         },
         extraBulkActions: ({ selectedIndices, bulkUpdate, clear }) => (
            <>
               <ImportBulkStatusButton
                  bulkUpdate={bulkUpdate}
                  clear={clear}
                  selectedIndices={selectedIndices}
               />
               <ImportBulkDateButton
                  bulkUpdate={bulkUpdate}
                  clear={clear}
                  selectedIndices={selectedIndices}
               />
               <ImportBulkCategoryButton
                  bulkUpdate={bulkUpdate}
                  categories={safeCategories}
                  clear={clear}
                  selectedIndices={selectedIndices}
               />
               <ImportBulkAccountButton
                  bankAccounts={safeBankAccounts}
                  bulkUpdate={bulkUpdate}
                  clear={clear}
                  selectedIndices={selectedIndices}
               />
            </>
         ),
         onImport: async (rows) => {
            if (!activeTeamId) {
               throw new Error("Time ativo não encontrado.");
            }
            const missingCategoryRows: number[] = [];
            const missingReferenceRows: number[] = [];
            const invalidDateValueRows: number[] = [];
            const invalidAmountRows: number[] = [];
            const transactions = rows.flatMap((r, index) => {
               const line = index + 2;
               const date = String(r.date ?? "");
               const amount = String(r.amount ?? "");
               const bankAccountId =
                  resolveImportId(safeBankAccounts, r.bankAccountId) ??
                  resolveImportId(safeBankAccounts, r.bankAccountName);
               const creditCardId =
                  resolveImportId(safeCreditCards, r.creditCardId) ??
                  resolveImportId(safeCreditCards, r.creditCardName);
               const categoryId =
                  resolveImportId(safeCategories, r.categoryId) ??
                  resolveImportId(safeCategories, r.categoryName);
               const parsedType = parseImportType(r.type, 1);
               const relationshipId =
                  resolveImportId(safeCustomers, r.relationshipId) ??
                  resolveImportId(safeSuppliers, r.relationshipId) ??
                  (parsedType === "income"
                     ? (resolveImportId(safeCustomers, r.customerName) ??
                       resolveImportId(safeCustomers, r.relationshipName))
                     : (resolveImportId(safeSuppliers, r.supplierName) ??
                       resolveImportId(safeSuppliers, r.relationshipName)));

               if (!date) {
                  invalidDateValueRows.push(line);
                  return [];
               }
               if (!amount) {
                  invalidAmountRows.push(line);
                  return [];
               }
               if (!bankAccountId && !creditCardId) {
                  missingReferenceRows.push(line);
                  return [];
               }
               if (!categoryId) {
                  missingCategoryRows.push(line);
                  return [];
               }

               return [
                  {
                     type: parsedType,
                     amount,
                     date,
                     name: r.name ? String(r.name) : null,
                     bankAccountId,
                     destinationBankAccountId: null,
                     categoryId,
                     relationshipId,
                     attachments: [],
                     description: null,
                     creditCardId,
                     paymentMethod: parseImportPaymentMethod(r.paymentMethod),
                     status: parseImportStatus(r.status).status,
                     ignored:
                        r.ignored === true ||
                        parseImportStatus(r.status).ignored,
                     dueDate: r.dueDate ? String(r.dueDate) : null,
                  },
               ];
            });
            if (missingCategoryRows.length > 0) {
               throw new Error(
                  `A categoria é obrigatória. Preencha a categoria nas linhas: ${missingCategoryRows.join(", ")}.`,
               );
            }
            if (
               invalidDateValueRows.length > 0 ||
               invalidAmountRows.length > 0
            ) {
               throw new Error(
                  `Preencha data e valor nas linhas: ${[
                     ...invalidDateValueRows,
                     ...invalidAmountRows,
                  ]
                     .filter(
                        (value, index, array) => array.indexOf(value) === index,
                     )
                     .sort((left, right) => left - right)
                     .join(", ")}.`,
               );
            }
            if (missingReferenceRows.length > 0) {
               throw new Error(
                  `Informe conta ou cartão nas linhas: ${missingReferenceRows.join(", ")}.`,
               );
            }
            if (transactions.length === 0) {
               throw new Error(
                  "Nenhum lançamento válido para importar. Preencha data, valor, categoria e conta ou cartão.",
               );
            }
            const importTransactions = importTransactionsAction(
               transactionsCollection,
            );
            const transaction = importTransactions({
               input: { transactions, autoCategorize: false },
               rows: transactions.map((input) =>
                  buildOptimisticTransactionRow({
                     id: buildOptimisticTransactionRowId(),
                     input,
                     teamId: activeTeamId,
                     bankAccountName:
                        safeBankAccounts.find(
                           (account) => account.id === input.bankAccountId,
                        )?.name ?? null,
                     categoryName:
                        safeCategories.find(
                           (category) => category.id === input.categoryId,
                        )?.name ?? null,
                     creditCardName:
                        safeCreditCards.find(
                           (card) => card.id === input.creditCardId,
                        )?.name ?? null,
                     relationshipName:
                        safeCustomers.find(
                           (customer) => customer.id === input.relationshipId,
                        )?.name ??
                        safeSuppliers.find(
                           (supplier) => supplier.id === input.relationshipId,
                        )?.name ??
                        null,
                  }),
               ),
            });
            const result = await Result.tryPromise({
               try: () => transaction.isPersisted.promise,
               catch: (error) => error,
            });
            if (Result.isError(result)) {
               throw new Error(
                  getErrorMessage(
                     result.error,
                     "Erro ao importar lançamentos.",
                  ),
               );
            }
         },
      }),
      [
         activeTeamId,
         parseCsv,
         parseXlsx,
         parseOfx,
         generateCsv,
         generateXlsx,
         safeBankAccounts,
         safeCategories,
         safeCreditCards,
         safeCustomers,
         safeSuppliers,
         transactionsCollection,
      ],
   );

   const importUpdateRef = useRef<
      ((index: number, patch: Record<string, unknown>) => void) | null
   >(null);

   const columns = useMemo<ColumnDef<TransactionRow>[]>(() => {
      const base = buildTransactionColumns({
         bankAccounts: safeBankAccounts,
         categories: safeCategories,
         creditCards: safeCreditCards,
         customers: safeCustomers,
         suppliers: safeSuppliers,
         onUpdate: handleUpdate,
         onUpdateImport: (idx, patch) => importUpdateRef.current?.(idx, patch),
         onCreateBankAccount: handleCreateBankAccount,
         onCreateCategory: handleCreateCategory,
         onCreateCustomer: handleCreateCustomer,
         onCreateSupplier: handleCreateSupplier,
         onAcceptSuggestedCategory: handleAcceptSuggestedCategory,
         onDismissSuggestedCategory: handleDismissSuggestedCategory,
         getRowStatus: (id) => transactionData.find((t) => t.id === id)?.status,
         logoDevToken: publicEnv?.LOGO_DEV_TOKEN,
      });
      const selectColumn: ColumnDef<TransactionRow> = {
         id: "__select",
         size: 40,
         enableSorting: false,
         enableHiding: false,
         header: ({ table }) => (
            <Checkbox
               aria-label="Selecionar todos"
               checked={
                  table.getIsAllPageRowsSelected()
                     ? true
                     : table.getIsSomePageRowsSelected()
                       ? "indeterminate"
                       : false
               }
               onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            />
         ),
         cell: ({ row }) => (
            <Checkbox
               aria-label="Selecionar linha"
               checked={row.getIsSelected()}
               disabled={!row.getCanSelect()}
               onCheckedChange={(v) => row.toggleSelected(!!v)}
            />
         ),
      };
      const actionsColumn: ColumnDef<TransactionRow> = {
         id: "__actions",
         size: 180,
         enableSorting: false,
         enableHiding: false,
         meta: { align: "right" },
         cell: ({ row }) => {
            const tx = row.original;
            const { status: rowStatus, ignored } = tx;
            return (
               <div className="flex justify-end gap-2">
                  {!ignored && rowStatus === "pending" && (
                     <Button
                        className="text-green-600 hover:text-green-700"
                        onClick={() => handleMarkPaid(tx)}
                        size="icon-sm"
                        tooltip="Marcar como efetivado"
                        variant="ghost"
                     >
                        <CheckCircle2 />
                        <span className="sr-only">Marcar como efetivado</span>
                     </Button>
                  )}
                  {!ignored && rowStatus === "paid" && (
                     <Button
                        onClick={() => handleMarkUnpaid(tx)}
                        size="icon-sm"
                        tooltip="Marcar como pendente"
                        variant="ghost"
                     >
                        <Undo2 />
                        <span className="sr-only">Marcar como pendente</span>
                     </Button>
                  )}
                  {ignored ? (
                     <Button
                        onClick={() => handleReactivate(tx)}
                        size="icon-sm"
                        tooltip="Reativar"
                        variant="ghost"
                     >
                        <RotateCcw />
                        <span className="sr-only">Reativar</span>
                     </Button>
                  ) : (
                     <Button
                        onClick={() => handleCancel(tx)}
                        size="icon-sm"
                        tooltip="Ignorar lançamento"
                        variant="ghost"
                     >
                        <Ban />
                        <span className="sr-only">Ignorar lançamento</span>
                     </Button>
                  )}
                  <Button
                     className="text-destructive hover:text-destructive"
                     onClick={() => handleDelete(tx)}
                     size="icon-sm"
                     tooltip="Excluir"
                     variant="ghost"
                  >
                     <Trash2 />
                     <span className="sr-only">Excluir</span>
                  </Button>
               </div>
            );
         },
      };
      return [selectColumn, ...base, actionsColumn];
   }, [
      safeBankAccounts,
      safeCategories,
      safeCreditCards,
      safeCustomers,
      safeSuppliers,
      transactionData,
      publicEnv?.LOGO_DEV_TOKEN,
      handleUpdate,
      handleCreateBankAccount,
      handleCreateCategory,
      handleCreateCustomer,
      handleCreateSupplier,
      handleAcceptSuggestedCategory,
      handleDismissSuggestedCategory,
      handleMarkPaid,
      handleMarkUnpaid,
      handleReactivate,
      handleCancel,
      handleDelete,
   ]);

   const effectiveColumnFilters = useMemo<ColumnFiltersState>(() => {
      const next = columnFilters.filter(
         (filter) =>
            filter.id !== "bankAccountName" &&
            filter.id !== "customerName" &&
            filter.id !== "supplierName" &&
            filter.id !== "date",
      );
      if (effectiveBankId) {
         next.push({ id: "bankAccountName", value: effectiveBankId });
      }
      if (effectiveRelationshipId) {
         const relationshipFilterId = safeSuppliers.some(
            (supplier) => supplier.id === effectiveRelationshipId,
         )
            ? "supplierName"
            : "customerName";
         next.push({
            id: relationshipFilterId,
            value: effectiveRelationshipId,
         });
      }
      if (effectiveDateFrom || effectiveDateTo) {
         next.push({
            id: "date",
            value: {
               from: effectiveDateFrom || undefined,
               to: effectiveDateTo || undefined,
            },
         });
      }
      return next;
   }, [
      columnFilters,
      effectiveDateFrom,
      effectiveDateTo,
      effectiveBankId,
      effectiveRelationshipId,
      safeSuppliers,
   ]);

   const urlState = useTableUrlState({
      search: {
         sorting,
         columnFilters: effectiveColumnFilters,
         page,
         pageSize,
         grouping: [],
      },
      onUpdate: (next) =>
         navigate({
            search: (prev) => {
               const merged = { ...prev, ...next };
               if (next.columnFilters) {
                  const hasBankFilter = next.columnFilters.some(
                     (filter) => filter.id === "bankAccountName",
                  );
                  const hasRelationshipFilter = next.columnFilters.some(
                     (filter) =>
                        filter.id === "customerName" ||
                        filter.id === "supplierName",
                  );
                  const dateFilter = getDateRangeColumnFilterValue(
                     next.columnFilters,
                     "date",
                  );
                  return {
                     ...merged,
                     bankId: hasBankFilter ? merged.bankId : "",
                     columnFilters: next.columnFilters.filter(
                        (filter) => filter.id !== "date",
                     ),
                     dateFrom: dateFilter.from ?? "",
                     dateTo: dateFilter.to ?? "",
                     relationshipId: hasRelationshipFilter
                        ? merged.relationshipId
                        : "",
                  };
               }
               return merged;
            },
            replace: true,
         }),
      totalRows: total,
   });

   const defaultColumnOrder = useMemo(
      () => columns.map(getColumnDefId).filter((id): id is string => !!id),
      [columns],
   );
   const normalizedLayoutState = useMemo(
      () => ({
         ...layout.state,
         columnOrder: normalizeTransactionsColumnOrder(
            layout.state.columnOrder,
            defaultColumnOrder,
         ),
      }),
      [defaultColumnOrder, layout.state],
   );

   const table = useReactTable({
      data: transactionData,
      columns,
      getRowId: (row) => row.id,
      pageCount: urlState.pageCount,
      manualPagination: true,
      manualSorting: true,
      manualFiltering: true,
      columnResizeMode: "onChange",
      defaultColumn: { minSize: 80, size: 160, maxSize: 600 },
      state: { ...urlState.state, ...normalizedLayoutState },
      onSortingChange: urlState.onSortingChange,
      onColumnFiltersChange: urlState.onColumnFiltersChange,
      onPaginationChange: urlState.onPaginationChange,
      onRowSelectionChange: urlState.onRowSelectionChange,
      onColumnSizingChange: layout.onColumnSizingChange,
      onColumnOrderChange: layout.onColumnOrderChange,
      onColumnVisibilityChange: layout.onColumnVisibilityChange,
      onColumnPinningChange: layout.onColumnPinningChange,
      onGroupingChange: urlState.onGroupingChange,
      onExpandedChange: urlState.onExpandedChange,
      getCoreRowModel: getCoreRowModel(),
      getGroupedRowModel: getGroupedRowModel(),
      getExpandedRowModel: getExpandedRowModel(),
   });

   const importApi = useDataImport({ table, config: importConfig });
   importUpdateRef.current = importApi.updateRow;

   const selectedRows = table.getSelectedRowModel().rows;
   const selectedIds = selectedRows.map((r) => r.original.id);
   const resetSelection = () => table.resetRowSelection();

   useTableBulkActions({
      selectedCount: selectedRows.length,
      onClear: resetSelection,
      children: (
         <>
            <BulkIgnoreButton
               collection={transactionsCollection}
               ids={selectedIds}
               onSuccess={resetSelection}
            />
            <BulkStatusButton
               collection={transactionsCollection}
               ids={selectedIds}
               onSuccess={resetSelection}
            />
            <BulkDateButton
               collection={transactionsCollection}
               ids={selectedIds}
               onSuccess={resetSelection}
            />
            <BulkCategoryButton
               categories={safeCategories}
               collection={transactionsCollection}
               ids={selectedIds}
               onSuccess={resetSelection}
            />
            <BulkAccountButton
               bankAccounts={safeBankAccounts}
               collection={transactionsCollection}
               ids={selectedIds}
               onSuccess={resetSelection}
            />
            <SelectionActionButton
               icon={<Trash2 />}
               variant="destructive"
               onClick={() =>
                  openAlertDialog({
                     title: `Excluir ${selectedIds.length} ${selectedIds.length === 1 ? "lançamento" : "lançamentos"}`,
                     description:
                        "Tem certeza que deseja excluir os lançamentos selecionados? Esta ação não pode ser desfeita.",
                     actionLabel: "Excluir",
                     cancelLabel: "Cancelar",
                     variant: "destructive",
                     onAction: async () => {
                        const bulkRemove = bulkRemoveTransactionsAction(
                           transactionsCollection,
                        );
                        const result = await Result.tryPromise({
                           try: () =>
                              bulkRemove({ ids: selectedIds }).isPersisted
                                 .promise,
                           catch: (error) => error,
                        });
                        if (Result.isError(result)) {
                           toast.error(
                              getErrorMessage(
                                 result.error,
                                 "Erro ao excluir lançamentos.",
                              ),
                           );
                           return;
                        }
                        resetSelection();
                     },
                  })
               }
            >
               Excluir
            </SelectionActionButton>
         </>
      ),
   });

   return (
      <div className="flex flex-1 flex-col gap-4 min-h-0">
         <div className="flex flex-1 flex-col gap-4 min-h-0">
            <div className="flex flex-wrap items-center gap-2 justify-between">
               <SearchInput
                  className="max-w-sm"
                  aria-label="Buscar lançamentos"
                  onChange={(e) => searchInput.onChange(e.target.value)}
                  placeholder="Buscar por nome, descrição ou contato..."
                  value={searchInput.value}
               />
               <div className="flex flex-wrap items-center gap-2">
                  <DataTableColumnVisibility table={table} />
                  <ExportButton table={table} fileBase="lancamentos" />
                  <Button
                     disabled={isExportingPdf || !isTransactionsLoaded}
                     onClick={handleExportPdf}
                     tooltip="Exportar PDF"
                     variant="outline"
                     size="icon-sm"
                  >
                     {isExportingPdf ? (
                        <Loader2 className="animate-spin" />
                     ) : (
                        <FileDown />
                     )}
                     <span className="sr-only">Exportar PDF</span>
                  </Button>
                  <DataImportButton api={importApi} config={importConfig} />
                  <Button
                     onClick={handleCreate}
                     tooltip="Novo Lançamento"
                     variant="outline"
                     size="icon-sm"
                  >
                     <Plus />
                     <span className="sr-only">Novo Lançamento</span>
                  </Button>
               </div>
            </div>
            <TooltipProvider>
               <DataTableFilterChips table={table} />
               <ScrollArea className="flex-1 min-h-0 rounded-md border bg-card">
                  <Table
                     className="min-w-max"
                     wrapperClassName="w-max min-w-full overflow-visible"
                     style={{ minWidth: table.getTotalSize() }}
                  >
                     <DataTableHeader table={table} />
                     <DataImportSection
                        api={importApi}
                        config={importConfig}
                        table={table}
                     />
                     <DataTableBody<TransactionRow>
                        estimateRowHeight={48}
                        overscan={5}
                        virtualized
                        getRowClassName={({ row }) =>
                           cn(
                              row.original.ignored &&
                                 "bg-muted/20 text-muted-foreground opacity-60",
                           )
                        }
                        table={table}
                     />
                  </Table>
                  {isTransactionsLoaded && table.getRowCount() === 0 && (
                     <Empty>
                        <EmptyHeader>
                           <EmptyMedia variant="icon">
                              <ArrowLeftRight className="size-6" />
                           </EmptyMedia>
                           <EmptyTitle>Nenhum lançamento</EmptyTitle>
                           <EmptyDescription>
                              {search || effectiveColumnFilters.length > 0
                                 ? "Nenhum lançamento encontrado para os filtros aplicados."
                                 : "Registre um novo lançamento para começar a controlar suas finanças."}
                           </EmptyDescription>
                        </EmptyHeader>
                     </Empty>
                  )}
               </ScrollArea>
            </TooltipProvider>
            <DataTablePagination table={table} totalRows={total} />
         </div>
      </div>
   );
}

function BulkIgnoreButton({
   ids,
   onSuccess,
   collection,
}: {
   ids: string[];
   onSuccess: () => void;
   collection: Parameters<typeof bulkUpdateTransactionsAction>[0];
}) {
   const { openAlertDialog } = useAlertDialog();

   return (
      <SelectionActionButton
         icon={<Ban />}
         onClick={() =>
            openAlertDialog({
               title: `Ignorar ${ids.length} ${ids.length === 1 ? "lançamento" : "lançamentos"}`,
               description:
                  "Os lançamentos selecionados serão marcados como ignorados e não entrarão nos cálculos.",
               actionLabel: "Ignorar",
               cancelLabel: "Cancelar",
               onAction: async () => {
                  const update = bulkUpdateTransactionsAction(collection);
                  const result = await Result.tryPromise({
                     try: () =>
                        update({ ids, patch: { ignored: true } }).isPersisted
                           .promise,
                     catch: (error) => error,
                  });
                  if (Result.isError(result)) {
                     toast.error(
                        getErrorMessage(
                           result.error,
                           "Erro ao ignorar lançamentos.",
                        ),
                     );
                     return;
                  }
                  onSuccess();
               },
            })
         }
      >
         Ignorar lançamentos
      </SelectionActionButton>
   );
}

function BulkStatusButton({
   ids,
   onSuccess,
   collection,
}: {
   ids: string[];
   onSuccess: () => void;
   collection: Parameters<typeof bulkUpdateTransactionsAction>[0];
}) {
   const [open, setOpen] = useState(false);

   const apply = async (status: "pending" | "paid") => {
      const update = bulkUpdateTransactionsAction(collection);
      const result = await Result.tryPromise({
         try: () => update({ ids, patch: { status } }).isPersisted.promise,
         catch: (error) => error,
      });
      setOpen(false);
      if (Result.isError(result)) {
         toast.error(
            getErrorMessage(result.error, "Erro ao atualizar status."),
         );
         return;
      }
      onSuccess();
   };

   const statusOptions = [
      { value: "pending" as const, label: "Pendente" },
      { value: "paid" as const, label: "Efetivado" },
   ];

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<CircleDot />}>
               Status
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-44 p-1">
            <div className="flex flex-col">
               {statusOptions.map((opt) => (
                  <Button
                     key={opt.value}
                     className="justify-start text-sm"
                     variant="ghost"
                     onClick={() => apply(opt.value)}
                  >
                     {opt.label}
                  </Button>
               ))}
            </div>
         </PopoverContent>
      </Popover>
   );
}

function BulkDateButton({
   ids,
   onSuccess,
   collection,
}: {
   ids: string[];
   onSuccess: () => void;
   collection: Parameters<typeof bulkUpdateTransactionsAction>[0];
}) {
   const [open, setOpen] = useState(false);

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<CalendarDays />}>
               Data
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-auto p-0">
            <Calendar
               mode="single"
               onSelect={async (d) => {
                  if (!d) return;
                  const date = dayjs(d).format("YYYY-MM-DD");
                  const update = bulkUpdateTransactionsAction(collection);
                  const result = await Result.tryPromise({
                     try: () =>
                        update({ ids, patch: { date } }).isPersisted.promise,
                     catch: (error) => error,
                  });
                  setOpen(false);
                  if (Result.isError(result)) {
                     toast.error(
                        getErrorMessage(
                           result.error,
                           "Erro ao atualizar data.",
                        ),
                     );
                     return;
                  }
                  onSuccess();
               }}
            />
         </PopoverContent>
      </Popover>
   );
}

function BulkCategoryButton({
   ids,
   categories,
   onSuccess,
   collection,
}: {
   ids: string[];
   categories: CategoryOption[];
   onSuccess: () => void;
   collection: Parameters<typeof bulkUpdateTransactionsAction>[0];
}) {
   const [open, setOpen] = useState(false);

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<FolderOpen />}>
               Categoria
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-0">
            <BulkLookupCommand
               emptyMessage="Nenhuma categoria."
               options={categories}
               searchPlaceholder="Buscar..."
               onSelect={async (category) => {
                  const update = bulkUpdateTransactionsAction(collection);
                  const result = await Result.tryPromise({
                     try: () =>
                        update({
                           ids,
                           patch: { categoryId: category.id },
                        }).isPersisted.promise,
                     catch: (error) => error,
                  });
                  setOpen(false);
                  if (Result.isError(result)) {
                     toast.error(
                        getErrorMessage(result.error, "Erro ao categorizar."),
                     );
                     return;
                  }
                  onSuccess();
               }}
            />
         </PopoverContent>
      </Popover>
   );
}

function BulkAccountButton({
   ids,
   bankAccounts,
   onSuccess,
   collection,
}: {
   ids: string[];
   bankAccounts: BankAccountOption[];
   onSuccess: () => void;
   collection: Parameters<typeof bulkUpdateTransactionsAction>[0];
}) {
   const [open, setOpen] = useState(false);

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<Landmark />}>
               Conta
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-0">
            <BulkLookupCommand
               emptyMessage="Nenhuma conta."
               options={bankAccounts}
               searchPlaceholder="Buscar..."
               onSelect={async (bankAccount) => {
                  const update = bulkUpdateTransactionsAction(collection);
                  const result = await Result.tryPromise({
                     try: () =>
                        update({
                           ids,
                           patch: { bankAccountId: bankAccount.id },
                        }).isPersisted.promise,
                     catch: (error) => error,
                  });
                  setOpen(false);
                  if (Result.isError(result)) {
                     toast.error(
                        getErrorMessage(result.error, "Erro ao alterar conta."),
                     );
                     return;
                  }
                  onSuccess();
               }}
            />
         </PopoverContent>
      </Popover>
   );
}

type ImportBulkProps = {
   selectedIndices: Set<number>;
   bulkUpdate: (
      indices: Set<number>,
      keyOrPatch: string | Record<string, unknown>,
      value?: unknown,
   ) => void;
   clear: () => void;
};

type BulkLookupOption = {
   id: string;
   name: string;
};

function BulkLookupCommand({
   options,
   searchPlaceholder,
   emptyMessage,
   disabled,
   onSelect,
}: {
   options: BulkLookupOption[];
   searchPlaceholder: string;
   emptyMessage: string;
   disabled?: boolean;
   onSelect: (option: BulkLookupOption) => void;
}) {
   return (
      <Command>
         <CommandInput placeholder={searchPlaceholder} />
         <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
               {options.map((option) => (
                  <CommandItem
                     key={option.id}
                     disabled={disabled}
                     onSelect={() => onSelect(option)}
                     value={option.name}
                  >
                     {option.name}
                  </CommandItem>
               ))}
            </CommandGroup>
         </CommandList>
      </Command>
   );
}

function ImportBulkStatusButton({
   selectedIndices,
   bulkUpdate,
   clear,
}: ImportBulkProps) {
   const [open, setOpen] = useState(false);
   const opts = [
      { value: "pending", label: "Pendente" },
      { value: "paid", label: "Efetivado" },
   ];
   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<CircleDot />}>
               Status
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-44 p-1">
            <div className="flex flex-col">
               {opts.map((o) => (
                  <Button
                     key={o.value}
                     className="justify-start text-sm"
                     variant="ghost"
                     onClick={() => {
                        bulkUpdate(selectedIndices, "status", o.value);
                        setOpen(false);
                        clear();
                     }}
                  >
                     {o.label}
                  </Button>
               ))}
            </div>
         </PopoverContent>
      </Popover>
   );
}

function ImportBulkDateButton({
   selectedIndices,
   bulkUpdate,
   clear,
}: ImportBulkProps) {
   const [open, setOpen] = useState(false);
   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<CalendarDays />}>
               Data
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-auto p-0">
            <Calendar
               mode="single"
               onSelect={(d) => {
                  if (!d) return;
                  bulkUpdate(
                     selectedIndices,
                     "date",
                     dayjs(d).format("YYYY-MM-DD"),
                  );
                  setOpen(false);
                  clear();
               }}
            />
         </PopoverContent>
      </Popover>
   );
}

function ImportBulkCategoryButton({
   selectedIndices,
   bulkUpdate,
   clear,
   categories,
}: ImportBulkProps & { categories: CategoryOption[] }) {
   const [open, setOpen] = useState(false);
   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<FolderOpen />}>
               Categoria
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-0">
            <BulkLookupCommand
               emptyMessage="Nenhuma categoria."
               options={categories}
               searchPlaceholder="Buscar..."
               onSelect={(category) => {
                  bulkUpdate(selectedIndices, {
                     categoryId: category.id,
                     categoryName: category.name,
                  });
                  setOpen(false);
                  clear();
               }}
            />
         </PopoverContent>
      </Popover>
   );
}

function ImportBulkAccountButton({
   selectedIndices,
   bulkUpdate,
   clear,
   bankAccounts,
}: ImportBulkProps & { bankAccounts: BankAccountOption[] }) {
   const [open, setOpen] = useState(false);
   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <SelectionActionButton icon={<Landmark />}>
               Conta
            </SelectionActionButton>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-0">
            <BulkLookupCommand
               emptyMessage="Nenhuma conta."
               options={bankAccounts}
               searchPlaceholder="Buscar..."
               onSelect={(bankAccount) => {
                  bulkUpdate(selectedIndices, {
                     bankAccountId: bankAccount.id,
                     bankAccountName: bankAccount.name,
                  });
                  setOpen(false);
                  clear();
               }}
            />
         </PopoverContent>
      </Popover>
   );
}
