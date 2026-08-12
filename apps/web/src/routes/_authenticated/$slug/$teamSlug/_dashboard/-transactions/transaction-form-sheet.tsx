import { Button } from "@packages/ui/components/button";
import { Checkbox } from "@packages/ui/components/checkbox";
import {
   Collapsible,
   CollapsibleContent,
   CollapsibleTrigger,
} from "@packages/ui/components/collapsible";
import {
   Command,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
   CommandSeparator,
} from "@packages/ui/components/command";
import { Combobox } from "@packages/ui/components/combobox";
import { DatePicker } from "@packages/ui/components/date-picker";
import { Field, FieldError, FieldLabel } from "@packages/ui/components/field";
import { Input } from "@packages/ui/components/input";
import { MoneyInput } from "@packages/ui/components/money-input";
import { NumberInput } from "@packages/ui/components/number-input";
import {
   Popover,
   PopoverContent,
   PopoverTrigger,
} from "@packages/ui/components/popover";
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from "@packages/ui/components/select";
import {
   SheetClose,
   SheetDescription,
   SheetFooter,
   SheetHeader,
   SheetTitle,
} from "@packages/ui/components/sheet";
import { toast } from "@packages/ui/hooks/use-toast";
import { Textarea } from "@packages/ui/components/textarea";
import { UploadDropzone } from "@packages/ui/components/upload-dropzone";
import { UploadProgress } from "@packages/ui/components/upload-progress";
import { cn } from "@packages/ui/lib/utils";
import { Result } from "better-result";
import { useUploadFiles } from "@better-upload/client";
import imageCompression from "browser-image-compression";
import { format, of } from "@f-o-t/money";
import { useForm } from "@tanstack/react-form";
import dayjs from "dayjs";
import {
   CheckIcon,
   ChevronDown,
   ChevronRight,
   ChevronsUpDownIcon,
   CornerDownRight,
   FileText,
   Plus,
} from "lucide-react";
import posthog from "posthog-js";
import * as React from "react";
import { z } from "zod";
import { useSheet } from "@/hooks/use-sheet";
import type { Outputs } from "@/integrations/orpc/client";
import type { TransactionCreateInput } from "@/integrations/tanstack-db/transactions";
import { buildInstallmentPreview } from "@/utils/finance/installments";
import { CATEGORY_ICON_MAP } from "../-categories/category-icons";

type CategoryNode = Outputs["categories"]["getAll"][number];

type BankAccountNode = Outputs["bankAccounts"]["getAll"][number];

type TransactionFormSheetProps = {
   bankAccounts: BankAccountNode[];
   categories: CategoryNode[];
   onCreate: (input: TransactionCreateInput) => Promise<boolean>;
   onCreateCategory: (args: {
      type: "income" | "expense";
      name: string;
      onCreated: (category: CategoryNode) => void;
   }) => void;
};

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

const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
type TransactionType = (typeof TRANSACTION_TYPES)[number];

function parseTransactionType(value: string): TransactionType | undefined {
   return TRANSACTION_TYPES.find((t) => t === value);
}

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
   { value: "expense", label: "Despesa" },
   { value: "income", label: "Receita" },
   { value: "transfer", label: "Transferência" },
];

type TransactionStatus = "paid" | "pending";
type StatusOption = { value: TransactionStatus; label: string };
type PaymentMethod = NonNullable<TransactionCreateInput["paymentMethod"]>;
type RecurrenceFrequency = "daily" | "weekly" | "biweekly" | "monthly";

const PAYMENT_METHOD_NONE_VALUE = "__none";

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
   { value: "pix", label: "Pix" },
   { value: "credit_card", label: "Cartão de crédito" },
   { value: "debit_card", label: "Cartão de débito" },
   { value: "boleto", label: "Boleto" },
   { value: "cash", label: "Dinheiro" },
   { value: "transfer", label: "Transferência" },
   { value: "cheque", label: "Cheque" },
   { value: "automatic_debit", label: "Débito automático" },
   { value: "other", label: "Outro" },
];

const STATUS_OPTIONS: StatusOption[] = [
   { value: "paid", label: "Efetivado" },
   { value: "pending", label: "Pendente" },
];

const RECURRENCE_OPTIONS: {
   value: RecurrenceFrequency;
   label: string;
}[] = [
   { value: "daily", label: "Diário" },
   { value: "weekly", label: "Semanal" },
   { value: "biweekly", label: "Quinzenal" },
   { value: "monthly", label: "Mensal" },
];

const ATTACHMENT_MAX_FILES = 5;

function parseStatus(value: string): TransactionStatus | undefined {
   return STATUS_OPTIONS.find((s) => s.value === value)?.value;
}

function parsePaymentMethod(value: string): PaymentMethod | "" | undefined {
   if (value === PAYMENT_METHOD_NONE_VALUE) return "";
   return PAYMENT_METHOD_OPTIONS.find((option) => option.value === value)
      ?.value;
}

function parseRecurrenceFrequency(
   value: string,
): RecurrenceFrequency | undefined {
   return RECURRENCE_OPTIONS.find((o) => o.value === value)?.value;
}

function extractPublicUrls(metadata: unknown): Record<string, string> {
   if (typeof metadata !== "object" || metadata === null) return {};
   if (!("publicUrls" in metadata)) return {};
   const bag = metadata.publicUrls;
   if (typeof bag !== "object" || bag === null) return {};
   const out: Record<string, string> = {};
   for (const [key, value] of Object.entries(bag)) {
      if (typeof value === "string") out[key] = value;
   }
   return out;
}

const formSchema = z
   .object({
      type: z.enum(TRANSACTION_TYPES),
      name: z.string().trim().min(2, "Nome deve ter no mínimo 2 caracteres."),
      amount: z
         .number({ message: "Valor é obrigatório." })
         .positive("Valor deve ser maior que zero."),
      date: z.string().min(1, "Data é obrigatória."),
      status: z.enum(["pending", "paid"]),
      paymentMethod: z
         .enum([
            "pix",
            "credit_card",
            "debit_card",
            "boleto",
            "cash",
            "transfer",
            "other",
            "cheque",
            "automatic_debit",
         ])
         .or(z.literal("")),
      ignored: z.boolean(),
      isInstallment: z.boolean(),
      installmentCount: z
         .number({ message: "Número de parcelas é obrigatório." })
         .optional(),
      isRecurring: z.boolean(),
      recurrenceFrequency: z.enum(["daily", "weekly", "biweekly", "monthly"]),
      dueDate: z.string(),
      bankAccountId: z.string(),
      destinationBankAccountId: z.string(),
      categoryId: z.string(),
      description: z
         .string()
         .max(500, "Observações deve ter no máximo 500 caracteres."),
      attachments: z
         .array(
            z.object({
               url: z.string(),
               filename: z.string(),
               size: z.number(),
               mimeType: z.string().optional(),
            }),
         )
         .max(
            ATTACHMENT_MAX_FILES,
            `Máximo de ${ATTACHMENT_MAX_FILES} anexos.`,
         ),
   })
   .superRefine((v, ctx) => {
      if (v.type === "transfer") {
         if (!v.bankAccountId) {
            ctx.addIssue({
               code: z.ZodIssueCode.custom,
               path: ["bankAccountId"],
               message: "Transferências exigem uma conta de origem.",
            });
         }
         if (!v.destinationBankAccountId) {
            ctx.addIssue({
               code: z.ZodIssueCode.custom,
               path: ["destinationBankAccountId"],
               message: "Transferências exigem uma conta de destino.",
            });
         }
         if (
            v.bankAccountId &&
            v.destinationBankAccountId &&
            v.bankAccountId === v.destinationBankAccountId
         ) {
            ctx.addIssue({
               code: z.ZodIssueCode.custom,
               path: ["destinationBankAccountId"],
               message: "Conta de origem e destino devem ser diferentes.",
            });
         }
      }
      if (v.type === "expense") {
         if (!v.bankAccountId) {
            ctx.addIssue({
               code: z.ZodIssueCode.custom,
               path: ["bankAccountId"],
               message: "Despesas exigem uma conta bancária.",
            });
         }
      }
      if (v.type === "income") {
         if (!v.bankAccountId) {
            ctx.addIssue({
               code: z.ZodIssueCode.custom,
               path: ["bankAccountId"],
               message: "Receitas exigem uma conta bancária.",
            });
         }
      }
      if (v.type !== "transfer" && !v.categoryId) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categoryId"],
            message: "Categoria é obrigatória.",
         });
      }
      if (v.type === "transfer" && v.isInstallment) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["isInstallment"],
            message: "Transferências não podem ser parceladas.",
         });
      }
      if (v.isRecurring && v.isInstallment) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["isRecurring"],
            message: "Lançamento recorrente não pode ser parcelado.",
         });
      }
      if (v.isInstallment && !v.installmentCount) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["installmentCount"],
            message: "Número de parcelas é obrigatório.",
         });
      }
      if (
         v.isInstallment &&
         v.installmentCount !== undefined &&
         !Number.isInteger(v.installmentCount)
      ) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["installmentCount"],
            message: "Número de parcelas deve ser inteiro.",
         });
      }
      if (
         v.isInstallment &&
         v.installmentCount !== undefined &&
         v.installmentCount < 2
      ) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["installmentCount"],
            message: "Número de parcelas deve ser maior que 1.",
         });
      }
      if (
         v.isInstallment &&
         v.installmentCount !== undefined &&
         v.installmentCount > 120
      ) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["installmentCount"],
            message: "Número de parcelas deve ser menor ou igual a 120.",
         });
      }
      if (
         v.isInstallment &&
         v.amount > 0 &&
         v.installmentCount !== undefined &&
         v.installmentCount >= 2
      ) {
         const preview = buildInstallmentPreview({
            amount: String(v.amount),
            count: v.installmentCount,
            date: v.date,
            dueDate: v.dueDate || null,
         });
         if (preview.isErr()) {
            ctx.addIssue({
               code: z.ZodIssueCode.custom,
               path: ["installmentCount"],
               message: preview.error,
            });
         }
      }
   });

type FormValues = z.input<typeof formSchema>;

const DEFAULT_VALUES: FormValues = {
   type: "expense",
   name: "",
   amount: 0,
   date: dayjs().format("YYYY-MM-DD"),
   status: "paid",
   paymentMethod: "",
   ignored: false,
   isInstallment: false,
   installmentCount: 2,
   isRecurring: false,
   recurrenceFrequency: "monthly",
   dueDate: "",
   bankAccountId: "",
   destinationBankAccountId: "",
   categoryId: "",
   description: "",
   attachments: [],
};

function isFieldInvalid(field: {
   state: { meta: { isTouched: boolean; errors: unknown[] } };
}) {
   return field.state.meta.isTouched && field.state.meta.errors.length > 0;
}

function formatMoney(value: string) {
   return format(of(value, "BRL"), "pt-BR");
}

async function compressIfImage(files: File[]) {
   return Promise.all(
      files.map((file) =>
         file.type.startsWith("image/")
            ? imageCompression(file, {
                 maxSizeMB: 1,
                 maxWidthOrHeight: 2048,
                 useWebWorker: true,
              })
            : file,
      ),
   );
}

interface CategoryPickerProps {
   categories: CategoryNode[];
   value: string;
   onValueChange: (value: string) => void;
   onCreateCategory: (
      name: string,
      onCreated: (category: CategoryNode) => void,
   ) => void;
   onBlur?: React.FocusEventHandler<HTMLButtonElement>;
   id?: string;
}

function getCategoryParentChain(
   category: CategoryNode,
   categoriesById: Map<string, CategoryNode>,
) {
   const chain: CategoryNode[] = [];
   const visited = new Set<string>();
   let current = category;

   while (current.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      const parent = categoriesById.get(current.parentId);
      if (!parent) return chain;
      chain.push(parent);
      current = parent;
   }

   return chain;
}

function getCategoryVisual(
   category: CategoryNode,
   categoriesById: Map<string, CategoryNode>,
) {
   if (!category.parentId) {
      return { color: category.color, icon: category.icon };
   }

   const chain = getCategoryParentChain(category, categoriesById);
   const root = chain[chain.length - 1];
   return {
      color: root && !root.parentId ? root.color : null,
      icon: root && !root.parentId ? root.icon : null,
   };
}

function CategoryIcon({
   color,
   icon,
}: {
   color: string | null;
   icon: string | null;
}) {
   const IconComponent = icon
      ? (CATEGORY_ICON_MAP[icon] ?? CATEGORY_ICON_MAP.briefcase)
      : CATEGORY_ICON_MAP.briefcase;
   const tint = color ?? "#71717a";

   return (
      <span
         className="flex size-6 shrink-0 items-center justify-center rounded-full"
         style={{ backgroundColor: `${tint}1f`, color: tint }}
      >
         <IconComponent className="size-3" />
      </span>
   );
}

function CategoryPickerRow({
   category,
   categoriesById,
   checked,
   isChild,
}: {
   category: CategoryNode;
   categoriesById: Map<string, CategoryNode>;
   checked: boolean;
   isChild: boolean;
}) {
   const visual = getCategoryVisual(category, categoriesById);

   return (
      <>
         <span className="flex size-4 shrink-0 items-center justify-center">
            {isChild ? (
               <CornerDownRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground/60"
               />
            ) : null}
         </span>
         <CategoryIcon color={visual.color} icon={visual.icon} />
         <span
            className={cn(
               "min-w-0 flex-1 truncate",
               isChild ? "text-muted-foreground" : "font-medium",
            )}
         >
            {category.name}
         </span>
         <CheckIcon
            className={cn(
               "size-4 shrink-0",
               checked ? "opacity-100" : "opacity-0",
            )}
         />
      </>
   );
}

function CategoryPicker({
   categories,
   value,
   onValueChange,
   onCreateCategory,
   onBlur,
   id,
}: CategoryPickerProps) {
   const [open, setOpen] = React.useState(false);
   const [search, setSearch] = React.useState("");
   const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
   const [createdExtras, setCreatedExtras] = React.useState<CategoryNode[]>([]);

   const mergedCategories = React.useMemo(() => {
      if (createdExtras.length === 0) return categories;
      const existing = new Set(categories.map((c) => c.id));
      return [...categories, ...createdExtras.filter((c) => !existing.has(c.id))];
   }, [categories, createdExtras]);

   const { roots, childrenByParent, byId } = React.useMemo(() => {
      const byId = new Map<string, CategoryNode>();
      const childrenByParent = new Map<string, CategoryNode[]>();
      const roots: CategoryNode[] = [];
      for (const c of mergedCategories) byId.set(c.id, c);
      for (const c of mergedCategories) {
         if (c.parentId) {
            const list = childrenByParent.get(c.parentId) ?? [];
            list.push(c);
            childrenByParent.set(c.parentId, list);
         } else {
            roots.push(c);
         }
      }
      return { roots, childrenByParent, byId };
   }, [mergedCategories]);

   const selected = value ? byId.get(value) : undefined;
   const selectedLabel = selected
      ? selected.parentId
         ? `${byId.get(selected.parentId)?.name ?? ""} / ${selected.name}`
         : selected.name
      : null;
   const selectedVisual = selected ? getCategoryVisual(selected, byId) : null;

   const term = search.trim().toLowerCase();

   const visibleRoots = React.useMemo(() => {
      if (!term) return roots;
      return roots.filter((r) => {
         if (r.name.toLowerCase().includes(term)) return true;
         const kids = childrenByParent.get(r.id) ?? [];
         return kids.some((k) => k.name.toLowerCase().includes(term));
      });
   }, [roots, childrenByParent, term]);

   const isRootExpanded = (rootId: string) =>
      term ? true : expanded.has(rootId);

   const toggleExpanded = (rootId: string) => {
      setExpanded((prev) => {
         const next = new Set(prev);
         if (next.has(rootId)) next.delete(rootId);
         else next.add(rootId);
         return next;
      });
   };

   const handleSelect = (id: string) => {
      onValueChange(id === value ? "" : id);
      setOpen(false);
      setSearch("");
   };

   const handleCreateCategory = () => {
      onCreateCategory(search.trim(), (category) => {
         setCreatedExtras((prev) =>
            prev.some((c) => c.id === category.id) ? prev : [...prev, category],
         );
         onValueChange(category.id);
         setOpen(false);
         setSearch("");
      });
   };

   return (
      <Popover
         onOpenChange={(o) => {
            setOpen(o);
            if (!o) setSearch("");
         }}
         open={open}
      >
         <PopoverTrigger asChild>
            <Button
               aria-expanded={open}
               className="flex truncate items-center gap-2"
               id={id}
               onBlur={onBlur}
               role="combobox"
               variant="outline"
            >
               {selected ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                     <CategoryIcon
                        color={selectedVisual?.color ?? null}
                        icon={selectedVisual?.icon ?? null}
                     />
                     <span className="truncate text-left">{selectedLabel}</span>
                  </span>
               ) : (
                  <span className="min-w-0 flex-1 truncate text-left">
                     Selecionar categoria...
                  </span>
               )}
               <ChevronsUpDownIcon className="size-4 shrink-0" />
            </Button>
         </PopoverTrigger>
         <PopoverContent className="p-0">
            <Command shouldFilter={false}>
               <CommandInput
                  onValueChange={setSearch}
                  placeholder="Buscar categoria..."
                  value={search}
               />
               <CommandList>
                  {visibleRoots.length === 0 ? (
                     <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {term
                           ? "Nenhuma categoria encontrada."
                           : "Nenhuma categoria ainda."}
                     </div>
                  ) : null}
                  <CommandGroup>
                     {visibleRoots.map((root) => {
                        const kids = childrenByParent.get(root.id) ?? [];
                        const expandedNow = isRootExpanded(root.id);
                        const visibleKids = term
                           ? kids.filter(
                                (k) =>
                                   k.name.toLowerCase().includes(term) ||
                                   root.name.toLowerCase().includes(term),
                             )
                           : kids;
                        return (
                           <React.Fragment key={root.id}>
                              <CommandItem
                                 value={root.id}
                                 onSelect={() => handleSelect(root.id)}
                                 className="gap-2"
                              >
                                 {kids.length > 0 ? (
                                    <button
                                       aria-label={
                                          expandedNow ? "Recolher" : "Expandir"
                                       }
                                       className="flex size-4 items-center justify-center rounded hover:bg-accent"
                                       onClick={(e) => {
                                          e.stopPropagation();
                                          toggleExpanded(root.id);
                                       }}
                                       type="button"
                                    >
                                       <ChevronRight
                                          className={cn(
                                             "size-3 transition-transform",
                                             expandedNow && "rotate-90",
                                          )}
                                       />
                                    </button>
                                 ) : (
                                    <span className="size-4" />
                                 )}
                                 <CategoryPickerRow
                                    category={root}
                                    categoriesById={byId}
                                    checked={value === root.id}
                                    isChild={false}
                                 />
                              </CommandItem>
                              {expandedNow
                                 ? visibleKids.map((child) => (
                                      <CommandItem
                                         key={child.id}
                                         value={child.id}
                                         onSelect={() => handleSelect(child.id)}
                                         className="gap-2"
                                      >
                                         <span className="size-4 shrink-0" />
                                         <CategoryPickerRow
                                            category={child}
                                            categoriesById={byId}
                                            checked={value === child.id}
                                            isChild
                                         />
                                      </CommandItem>
                                   ))
                                 : null}
                           </React.Fragment>
                        );
                     })}
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup>
                     <CommandItem
                        value="__create-category"
                        onSelect={handleCreateCategory}
                        className="gap-2"
                     >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                           <Plus className="size-3" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                           {term
                              ? `Criar categoria "${search.trim()}"`
                              : "Criar categoria"}
                        </span>
                     </CommandItem>
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}

export function TransactionFormSheet({
   bankAccounts,
   categories,
   onCreate,
   onCreateCategory,
}: TransactionFormSheetProps) {
   const { closeTopSheet } = useSheet();

   const bankOptions = bankAccounts.map((b) => ({
      value: b.id,
      label: b.name,
   }));

   const submitCreate = React.useCallback(
      async (input: TransactionCreateInput) => {
         const result = await Result.tryPromise({
            try: () => onCreate(input),
            catch: (error) => error,
         });
         if (Result.isError(result)) {
            toast.error(
               getErrorMessage(result.error, "Erro ao criar lançamento."),
            );
            return;
         }
         if (!result.value) {
            toast.error("Não foi possível criar o lançamento.");
            return;
         }
         posthog.capture("transaction_created", { type: input.type });
         toast.success("Lançamento criado com sucesso.");
         closeTopSheet();
      },
      [closeTopSheet, onCreate],
   );

   const form = useForm({
      defaultValues: DEFAULT_VALUES,
      validators: { onMount: formSchema, onChange: formSchema },
      onSubmitInvalid: ({ formApi }) => {
         const fields = Object.entries(formApi.state.fieldMeta)
            .filter(([, meta]) => meta.errors.length > 0)
            .map(([name]) => name);
         posthog.capture("transaction_create_validation_failed", {
            type: formApi.state.values.type,
            fields,
         });
      },
      onSubmit: async ({ value }) => {
         const attachments = value.attachments;
         await submitCreate({
            type: value.type,
            name: value.name.trim(),
            amount: String(value.amount),
            date: value.date,
            status: value.status,
            ignored: value.ignored,
            isInstallment:
               value.type !== "transfer" && !value.isRecurring
                  ? value.isInstallment
                  : false,
            installmentCount:
               value.type !== "transfer" &&
               !value.isRecurring &&
               value.isInstallment
                  ? value.installmentCount
                  : undefined,
            isRecurring: value.isRecurring,
            recurrenceFrequency: value.isRecurring
               ? value.recurrenceFrequency
               : undefined,
            dueDate: value.dueDate || null,
            bankAccountId: value.bankAccountId || null,
            destinationBankAccountId:
               value.type === "transfer"
                  ? value.destinationBankAccountId || null
                  : null,
            categoryId:
               value.type === "transfer" ? null : value.categoryId || null,
            attachments,
            description: value.description.trim() || null,
            paymentMethod: value.paymentMethod || null,
         });
      },
   });

   const upload = useUploadFiles({
      api: "/api/upload",
      route: "transactionAttachment",
      onBeforeUpload: ({ files }) => compressIfImage(files),
      onUploadComplete: ({ files, metadata }) => {
         const publicUrls = extractPublicUrls(metadata);
         const added: {
            url: string;
            filename: string;
            size: number;
            mimeType?: string;
         }[] = [];
         for (const f of files) {
            const url = publicUrls[f.objectInfo.key];
            if (!url) continue;
            added.push({
               url,
               filename: f.name,
               size: f.size,
               mimeType: f.type || undefined,
            });
         }
         if (added.length === 0) return;
         form.setFieldValue("attachments", (prev) => {
            const remaining = Math.max(0, ATTACHMENT_MAX_FILES - prev.length);
            const next = added.slice(0, remaining);
            const skipped = added.length - next.length;
            if (skipped > 0) {
               toast.error(
                  `${skipped} arquivo${skipped === 1 ? "" : "s"} ignorado${skipped === 1 ? "" : "s"}: limite de ${ATTACHMENT_MAX_FILES} anexos.`,
               );
            }
            return [...prev, ...next];
         });
      },
      onUploadFail: ({ failedFiles }) => {
         for (const f of failedFiles) {
            toast.error(`${f.name}: ${f.error.message}`);
         }
      },
      onError: (error) => toast.error(error.message),
   });

   return (
      <>
         <SheetHeader>
            <SheetTitle>Novo lançamento</SheetTitle>
            <SheetDescription>
               Registre uma receita, despesa ou transferência.
            </SheetDescription>
         </SheetHeader>

         <form
            className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto px-4"
            onSubmit={(e) => {
               e.preventDefault();
               form.handleSubmit();
            }}
         >
            <form.Field name="type">
               {(field) => (
                  <Field>
                     <FieldLabel htmlFor={field.name} required>
                        Tipo
                     </FieldLabel>
                     <Select
                        value={field.state.value}
                        onValueChange={(v) => {
                           const parsed = parseTransactionType(v);
                           if (!parsed) return;
                           field.handleChange(parsed);
                           form.setFieldValue("categoryId", "");
                           if (parsed === "transfer") {
                              form.setFieldValue("isInstallment", false);
                           }
                        }}
                     >
                        <SelectTrigger id={field.name} name={field.name}>
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           {TYPE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                 {o.label}
                              </SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </Field>
               )}
            </form.Field>

            <form.Subscribe selector={(s) => s.values.type}>
               {(type) => {
                  const filteredCategories = categories.filter((c) =>
                     type === "transfer"
                        ? false
                        : type === "income"
                          ? c.type === "income"
                          : c.type === "expense",
                  );
                  return (
                     <div className="flex flex-col gap-4">
                        <form.Field name="bankAccountId">
                           {(field) => (
                              <Field
                                 data-invalid={
                                    isFieldInvalid(field) || undefined
                                 }
                              >
                                 <FieldLabel htmlFor={field.name} required>
                                    {type === "transfer"
                                       ? "Conta de origem"
                                       : "Conta bancária"}
                                 </FieldLabel>
                                 <Combobox
                                    emptyMessage="Nenhuma conta."
                                    id={field.name}
                                    options={bankOptions}
                                    placeholder="Selecionar conta..."
                                    searchPlaceholder="Buscar conta..."
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onValueChange={(v) => field.handleChange(v)}
                                 />
                                 {isFieldInvalid(field) ? (
                                    <FieldError>
                                       {field.state.meta.errors[0]?.message}
                                    </FieldError>
                                 ) : null}
                              </Field>
                           )}
                        </form.Field>

                        {type === "transfer" ? (
                           <form.Field name="destinationBankAccountId">
                              {(field) => (
                                 <Field
                                    data-invalid={
                                       isFieldInvalid(field) || undefined
                                    }
                                 >
                                    <FieldLabel htmlFor={field.name} required>
                                       Conta de destino
                                    </FieldLabel>
                                    <Combobox
                                       emptyMessage="Nenhuma conta."
                                       id={field.name}
                                       options={bankOptions}
                                       placeholder="Selecionar conta..."
                                       searchPlaceholder="Buscar conta..."
                                       value={field.state.value}
                                       onBlur={field.handleBlur}
                                       onValueChange={(v) =>
                                          field.handleChange(v)
                                       }
                                    />
                                    {isFieldInvalid(field) ? (
                                       <FieldError>
                                          {field.state.meta.errors[0]?.message}
                                       </FieldError>
                                    ) : null}
                                 </Field>
                              )}
                           </form.Field>
                        ) : null}

                        {type !== "transfer" ? (
                           <form.Field name="categoryId">
                              {(field) => (
                                 <Field
                                    data-invalid={
                                       isFieldInvalid(field) || undefined
                                    }
                                 >
                                    <FieldLabel htmlFor={field.name} required>
                                       Categoria
                                    </FieldLabel>
                                    <CategoryPicker
                                       categories={filteredCategories}
                                       id={field.name}
                                       value={field.state.value}
                                       onBlur={field.handleBlur}
                                       onValueChange={(v) =>
                                          field.handleChange(v)
                                       }
                                       onCreateCategory={(name, onCreated) =>
                                          onCreateCategory({
                                             type:
                                                type === "income"
                                                   ? "income"
                                                   : "expense",
                                             name,
                                             onCreated,
                                          })
                                       }
                                    />
                                    {isFieldInvalid(field) ? (
                                       <FieldError>
                                          {field.state.meta.errors[0]?.message}
                                       </FieldError>
                                    ) : null}
                                 </Field>
                              )}
                           </form.Field>
                        ) : null}
                     </div>
                  );
               }}
            </form.Subscribe>

            <div className="grid grid-cols-2 gap-4">
               <form.Field name="date">
                  {(field) => (
                     <Field data-invalid={isFieldInvalid(field) || undefined}>
                        <FieldLabel htmlFor={field.name} required>
                           Data
                        </FieldLabel>
                        <DatePicker
                           className="w-full overflow-hidden [&>span]:truncate"
                           date={
                              field.state.value
                                 ? dayjs(field.state.value).toDate()
                                 : undefined
                           }
                           placeholder="Selecionar"
                           onSelect={(d) =>
                              field.handleChange(
                                 d ? dayjs(d).format("YYYY-MM-DD") : "",
                              )
                           }
                        />
                        {isFieldInvalid(field) ? (
                           <FieldError>
                              {field.state.meta.errors[0]?.message}
                           </FieldError>
                        ) : null}
                     </Field>
                  )}
               </form.Field>

               <form.Field name="amount">
                  {(field) => (
                     <Field data-invalid={isFieldInvalid(field) || undefined}>
                        <FieldLabel htmlFor={field.name} required>
                           Valor
                        </FieldLabel>
                        <MoneyInput
                           aria-invalid={isFieldInvalid(field)}
                           id={field.name}
                           name={field.name}
                           value={field.state.value}
                           valueInCents={false}
                           onBlur={field.handleBlur}
                           onChange={(v) => field.handleChange(v ?? 0)}
                        />
                        {isFieldInvalid(field) ? (
                           <FieldError>
                              {field.state.meta.errors[0]?.message}
                           </FieldError>
                        ) : null}
                     </Field>
                  )}
               </form.Field>
            </div>

            <form.Field name="dueDate">
               {(field) => (
                  <Field>
                     <FieldLabel htmlFor={field.name}>Vencimento</FieldLabel>
                     <DatePicker
                        className="w-full overflow-hidden [&>span]:truncate"
                        date={
                           field.state.value
                              ? dayjs(field.state.value).toDate()
                              : undefined
                        }
                        placeholder="Selecionar"
                        onSelect={(d) =>
                           field.handleChange(
                              d ? dayjs(d).format("YYYY-MM-DD") : "",
                           )
                        }
                     />
                  </Field>
               )}
            </form.Field>

            <form.Subscribe
               selector={(s) => ({
                  amount: s.values.amount,
                  date: s.values.date,
                  dueDate: s.values.dueDate,
                  installmentCount: s.values.installmentCount,
                  isInstallment: s.values.isInstallment,
                  isRecurring: s.values.isRecurring,
                  type: s.values.type,
               })}
            >
               {({
                  amount,
                  date,
                  dueDate,
                  installmentCount,
                  isInstallment,
                  isRecurring,
                  type,
               }) => {
                  if (type === "transfer") return null;
                  const canPreview =
                     isInstallment &&
                     !isRecurring &&
                     amount > 0 &&
                     installmentCount !== undefined &&
                     installmentCount >= 2;
                  const preview = canPreview
                     ? buildInstallmentPreview({
                          amount: String(amount),
                          count: installmentCount,
                          date,
                          dueDate: dueDate || null,
                       })
                     : null;

                  return (
                     <div className="flex flex-col gap-4 rounded-md border p-4">
                        <form.Field name="isInstallment">
                           {(field) => (
                              <Field
                                 data-invalid={
                                    isFieldInvalid(field) || undefined
                                 }
                                 orientation="horizontal"
                              >
                                 <Checkbox
                                    aria-invalid={isFieldInvalid(field)}
                                    checked={field.state.value}
                                    id={field.name}
                                    name={field.name}
                                    onBlur={field.handleBlur}
                                    onCheckedChange={(checked) => {
                                       const next = checked === true;
                                       field.handleChange(next);
                                       if (next) {
                                          form.setFieldValue(
                                             "isRecurring",
                                             false,
                                          );
                                       }
                                    }}
                                 />
                                 <FieldLabel htmlFor={field.name}>
                                    Parcelar lançamento
                                 </FieldLabel>
                                 {isFieldInvalid(field) ? (
                                    <FieldError>
                                       {field.state.meta.errors[0]?.message}
                                    </FieldError>
                                 ) : null}
                              </Field>
                           )}
                        </form.Field>

                        {isInstallment ? (
                           <>
                              <form.Field name="installmentCount">
                                 {(field) => (
                                    <Field
                                       data-invalid={
                                          isFieldInvalid(field) || undefined
                                       }
                                    >
                                       <FieldLabel
                                          htmlFor={field.name}
                                          required
                                       >
                                          Número de parcelas
                                       </FieldLabel>
                                       <NumberInput
                                          aria-invalid={isFieldInvalid(field)}
                                          id={field.name}
                                          max={120}
                                          min={2}
                                          name={field.name}
                                          value={field.state.value}
                                          onBlur={field.handleBlur}
                                          onChange={(value) =>
                                             field.handleChange(value)
                                          }
                                       />
                                       {isFieldInvalid(field) ? (
                                          <FieldError>
                                             {
                                                field.state.meta.errors[0]
                                                   ?.message
                                             }
                                          </FieldError>
                                       ) : null}
                                    </Field>
                                 )}
                              </form.Field>

                              {preview?.isOk() ? (
                                 <div className="flex flex-col gap-2 rounded-md bg-muted p-4 text-sm">
                                    {preview.value.map((installment) => (
                                       <div
                                          className="flex items-center justify-between gap-4"
                                          key={`installment-${installment.number}`}
                                       >
                                          <span>
                                             {installment.number}/
                                             {installment.count} -{" "}
                                             {dayjs(
                                                installment.dueDate ??
                                                   installment.date,
                                             ).format("DD/MM/YYYY")}
                                          </span>
                                          <strong>
                                             {formatMoney(installment.amount)}
                                          </strong>
                                       </div>
                                    ))}
                                 </div>
                              ) : null}
                           </>
                        ) : null}
                     </div>
                  );
               }}
            </form.Subscribe>

            <div className="flex flex-col gap-4 rounded-md border p-4">
               <form.Field name="isRecurring">
                  {(field) => (
                     <Field
                        data-invalid={isFieldInvalid(field) || undefined}
                        orientation="horizontal"
                     >
                        <Checkbox
                           aria-invalid={isFieldInvalid(field)}
                           checked={field.state.value}
                           id={field.name}
                           name={field.name}
                           onBlur={field.handleBlur}
                           onCheckedChange={(checked) => {
                              const next = checked === true;
                              field.handleChange(next);
                              if (next) {
                                 form.setFieldValue("isInstallment", false);
                              }
                           }}
                        />
                        <FieldLabel htmlFor={field.name}>
                           Lançamento recorrente
                        </FieldLabel>
                        {isFieldInvalid(field) ? (
                           <FieldError>
                              {field.state.meta.errors[0]?.message}
                           </FieldError>
                        ) : null}
                     </Field>
                  )}
               </form.Field>

               <form.Subscribe selector={(s) => s.values.isRecurring}>
                  {(isRecurring) =>
                     isRecurring ? (
                        <form.Field name="recurrenceFrequency">
                           {(field) => (
                              <Field
                                 data-invalid={
                                    isFieldInvalid(field) || undefined
                                 }
                              >
                                 <FieldLabel htmlFor={field.name} required>
                                    Periodicidade
                                 </FieldLabel>
                                 <Select
                                    value={field.state.value}
                                    onValueChange={(value) => {
                                       const parsed =
                                          parseRecurrenceFrequency(value);
                                       if (!parsed) return;
                                       field.handleChange(parsed);
                                    }}
                                 >
                                    <SelectTrigger
                                       aria-invalid={isFieldInvalid(field)}
                                       id={field.name}
                                       name={field.name}
                                    >
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                       {RECURRENCE_OPTIONS.map((option) => (
                                          <SelectItem
                                             key={option.value}
                                             value={option.value}
                                          >
                                             {option.label}
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                                 {isFieldInvalid(field) ? (
                                    <FieldError>
                                       {field.state.meta.errors[0]?.message}
                                    </FieldError>
                                 ) : null}
                              </Field>
                           )}
                        </form.Field>
                     ) : null
                  }
               </form.Subscribe>
            </div>

            <form.Field name="name">
               {(field) => (
                  <Field data-invalid={isFieldInvalid(field) || undefined}>
                     <FieldLabel htmlFor={field.name} required>
                        Nome
                     </FieldLabel>
                     <Input
                        aria-invalid={isFieldInvalid(field)}
                        id={field.name}
                        name={field.name}
                        placeholder="Ex.: Aluguel de maio"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                     />
                     {isFieldInvalid(field) ? (
                        <FieldError>
                           {field.state.meta.errors[0]?.message}
                        </FieldError>
                     ) : null}
                  </Field>
               )}
            </form.Field>

            <Collapsible>
               <CollapsibleTrigger asChild>
                  <Button
                     className="w-full justify-between [&[data-state=open]>svg]:rotate-180"
                     type="button"
                     variant="ghost"
                  >
                     Mais opções
                     <ChevronDown className="size-4 transition-transform" />
                  </Button>
               </CollapsibleTrigger>
               <CollapsibleContent className="flex flex-col gap-4 pt-4">
                  <form.Field name="status">
                     {(field) => (
                        <Field>
                           <FieldLabel htmlFor={field.name}>Status</FieldLabel>
                           <Select
                              value={field.state.value}
                              onValueChange={(v) => {
                                 const parsed = parseStatus(v);
                                 if (!parsed) return;
                                 field.handleChange(parsed);
                              }}
                           >
                              <SelectTrigger id={field.name} name={field.name}>
                                 <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                 {STATUS_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                       {o.label}
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                        </Field>
                     )}
                  </form.Field>

                  <form.Field name="paymentMethod">
                     {(field) => (
                        <Field>
                           <FieldLabel htmlFor={field.name}>
                              Forma de pagamento
                           </FieldLabel>
                           <Select
                              value={
                                 field.state.value || PAYMENT_METHOD_NONE_VALUE
                              }
                              onValueChange={(value) => {
                                 const parsed = parsePaymentMethod(value);
                                 if (parsed === undefined) return;
                                 field.handleChange(parsed);
                              }}
                           >
                              <SelectTrigger id={field.name} name={field.name}>
                                 <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                 <SelectItem value={PAYMENT_METHOD_NONE_VALUE}>
                                    Não informado
                                 </SelectItem>
                                 {PAYMENT_METHOD_OPTIONS.map((option) => (
                                    <SelectItem
                                       key={option.value}
                                       value={option.value}
                                    >
                                       {option.label}
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                        </Field>
                     )}
                  </form.Field>

                  <form.Field name="ignored">
                     {(field) => (
                        <Field
                           className="rounded-md border p-4"
                           orientation="horizontal"
                        >
                           <Checkbox
                              aria-invalid={isFieldInvalid(field)}
                              checked={field.state.value}
                              id={field.name}
                              name={field.name}
                              onBlur={field.handleBlur}
                              onCheckedChange={(checked) =>
                                 field.handleChange(checked === true)
                              }
                           />
                           <FieldLabel htmlFor={field.name}>
                              Ignorar lançamento
                           </FieldLabel>
                        </Field>
                     )}
                  </form.Field>

                  <form.Field name="description">
                     {(field) => (
                        <Field
                           data-invalid={isFieldInvalid(field) || undefined}
                        >
                           <FieldLabel htmlFor={field.name}>
                              Observações
                           </FieldLabel>
                           <Textarea
                              aria-invalid={isFieldInvalid(field)}
                              id={field.name}
                              name={field.name}
                              placeholder="Observações sobre o lançamento"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                 field.handleChange(e.target.value)
                              }
                           />
                           {isFieldInvalid(field) ? (
                              <FieldError>
                                 {field.state.meta.errors[0]?.message}
                              </FieldError>
                           ) : null}
                        </Field>
                     )}
                  </form.Field>

                  <form.Field name="attachments">
                     {(field) => (
                        <Field>
                           <FieldLabel>Anexos</FieldLabel>
                           <UploadDropzone
                              accept="image/*,application/pdf"
                              control={upload.control}
                              description={{
                                 maxFiles: ATTACHMENT_MAX_FILES,
                                 maxFileSize: "10MB",
                                 fileTypes: "imagens e PDF",
                              }}
                           />
                           {field.state.value.length > 0 ? (
                              <div className="grid grid-cols-3 gap-2">
                                 {field.state.value.map((a, index) => (
                                    <div
                                       key={`${a.url}-${index}`}
                                       className="relative aspect-square overflow-hidden rounded-md border bg-muted"
                                    >
                                       {a.mimeType?.startsWith("image/") ? (
                                          <img
                                             alt={a.filename}
                                             className="size-full object-cover"
                                             src={a.url}
                                          />
                                       ) : (
                                          <div className="flex size-full flex-col items-center justify-center gap-2 p-2 text-muted-foreground">
                                             <FileText className="size-6" />
                                             <span className="line-clamp-2 text-center text-xs">
                                                {a.filename}
                                             </span>
                                          </div>
                                       )}
                                    </div>
                                 ))}
                              </div>
                           ) : null}
                           <UploadProgress control={upload.control} />
                        </Field>
                     )}
                  </form.Field>
               </CollapsibleContent>
            </Collapsible>
         </form>

         <SheetFooter>
            <SheetClose asChild>
               <Button variant="outline">Cancelar</Button>
            </SheetClose>
            <form.Subscribe selector={(s) => s.isSubmitting}>
               {(isSubmitting) => (
                  <Button
                     disabled={isSubmitting || upload.control.isPending}
                     onClick={() => form.handleSubmit()}
                  >
                     Criar lançamento
                  </Button>
               )}
            </form.Subscribe>
         </SheetFooter>
      </>
   );
}
