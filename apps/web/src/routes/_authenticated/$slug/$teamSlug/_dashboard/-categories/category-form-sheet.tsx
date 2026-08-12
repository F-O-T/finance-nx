import {
   Autocomplete,
   type AutocompleteOption,
} from "@packages/ui/components/autocomplete";
import { Button } from "@packages/ui/components/button";
import {
   Collapsible,
   CollapsibleContent,
   CollapsibleTrigger,
} from "@packages/ui/components/collapsible";
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from "@packages/ui/components/command";
import {
   ColorPicker,
   ColorPickerEyeDropper,
   ColorPickerFormat,
   ColorPickerHue,
   ColorPickerOutput,
   ColorPickerSelection,
} from "@packages/ui/components/color-picker";
import {
   Field,
   FieldError,
   FieldGroup,
   FieldLabel,
} from "@packages/ui/components/field";
import { Input } from "@packages/ui/components/input";
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
import { Switch } from "@packages/ui/components/switch";
import {
   SheetClose,
   SheetDescription,
   SheetFooter,
   SheetHeader,
   SheetTitle,
} from "@packages/ui/components/sheet";
import { toast } from "@packages/ui/hooks/use-toast";
import type { Collection } from "@tanstack/react-db";
import { useForm } from "@tanstack/react-form";
import dayjs from "dayjs";
import { Check, ChevronDown, ChevronsUpDown } from "lucide-react";
import { fromPromise } from "neverthrow";
import { useState } from "react";
import { z } from "zod";
import { cn } from "@packages/ui/lib/utils";
import { useSheet } from "@/hooks/use-sheet";
import {
   createCategoryAction,
   type CategoriesCollectionRow,
} from "@/integrations/tanstack-db/categories";
import { CATEGORY_ICON_MAP, CATEGORY_ICON_OPTIONS } from "./category-icons";

const CATEGORY_TYPES = ["income", "expense", "transfer"] as const;
type CategoryType = (typeof CATEGORY_TYPES)[number];
type CategoryOption = CategoriesCollectionRow;

const NO_PARENT_VALUE = "sem-categoria-pai";

function parseCategoryType(value: string): CategoryType | undefined {
   return CATEGORY_TYPES.find((t) => t === value);
}

const TYPE_OPTIONS: { value: CategoryType; label: string }[] = [
   { value: "expense", label: "Despesa" },
   { value: "income", label: "Receita" },
   { value: "transfer", label: "Transferência" },
];

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;

const formSchema = z.object({
   type: z.enum(CATEGORY_TYPES),
   name: z
      .string()
      .trim()
      .min(2, "Nome deve ter no mínimo 2 caracteres.")
      .max(120, "Nome deve ter no máximo 120 caracteres."),
   parentId: z.string().min(1).optional().nullable(),
   icon: z.string().min(1),
   color: z
      .string()
      .regex(HEX_COLOR_REGEX, "Cor inválida.")
      .nullable()
      .optional(),
});

type FormValues = z.input<typeof formSchema>;

const COLOR_PRESETS = [
   "#ef4444",
   "#f97316",
   "#f59e0b",
   "#eab308",
   "#84cc16",
   "#22c55e",
   "#10b981",
   "#06b6d4",
   "#3b82f6",
   "#6366f1",
   "#8b5cf6",
   "#ec4899",
   "#64748b",
   "#0f172a",
];

function randomPresetColor() {
   const i = Math.floor(Math.random() * COLOR_PRESETS.length);
   return COLOR_PRESETS[i];
}

function renderParentOption(option: AutocompleteOption) {
   const iconKey = typeof option.icon === "string" ? option.icon : "briefcase";
   const Icon = CATEGORY_ICON_MAP[iconKey] ?? CATEGORY_ICON_MAP.briefcase;
   return (
      <span className="flex items-center gap-2">
         <Icon className="size-4" />
         {option.label}
      </span>
   );
}

function isFieldInvalid(field: {
   state: { meta: { isTouched: boolean; errors: unknown[] } };
}) {
   return field.state.meta.isTouched && field.state.meta.errors.length > 0;
}

function getErrorMessage(error: unknown) {
   if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.length > 0
   ) {
      return error.message;
   }
   return "Erro ao criar categoria.";
}

export function CategoryFormSheet({
   categories,
   collection,
   teamId,
   defaultType,
   defaultName,
   onCreated,
}: {
   categories: CategoryOption[];
   collection: Collection<CategoryOption, string>;
   teamId: string | null;
   defaultType?: CategoryType;
   defaultName?: string;
   onCreated?: (category: CategoryOption) => void;
}) {
   const { closeTopSheet } = useSheet();
   const [isSubcategory, setIsSubcategory] = useState(false);
   const [moreOpen, setMoreOpen] = useState(false);
   const [defaultValues] = useState<FormValues>(() => ({
      type: defaultType ?? "expense",
      name: defaultName ?? "",
      parentId: NO_PARENT_VALUE,
      icon: "briefcase",
      color: randomPresetColor(),
   }));

   const form = useForm({
      defaultValues,
      validators: { onMount: formSchema, onChange: formSchema },
      onSubmit: async ({ value }) => {
         if (!teamId) {
            toast.error("Time ativo não encontrado.");
            return;
         }
         const selectedParent = categories.find(
            (category) =>
               category.id === value.parentId &&
               category.type === value.type &&
               category.level < 3 &&
               !category.isArchived,
         );
         const now = dayjs().toDate();
         const createCategory = createCategoryAction(collection);
         const row: CategoryOption = {
            id: crypto.randomUUID(),
            teamId,
            parentId: selectedParent?.id ?? null,
            name: value.name.trim(),
            type: value.type,
            level: selectedParent ? selectedParent.level + 1 : 1,
            description: null,
            isDefault: false,
            color: selectedParent ? null : (value.color ?? null),
            icon: selectedParent ? null : value.icon,
            isArchived: false,
            notes: null,
            participatesDre: false,
            dreGroupId: null,
            createdAt: now,
            updatedAt: now,
         };
         const transaction = createCategory({
            row,
            input: {
               name: value.name.trim(),
               type: value.type,
               parentId: selectedParent?.id ?? null,
               icon: selectedParent ? null : value.icon,
               color: selectedParent ? null : (value.color ?? null),
               participatesDre: false,
            },
         });
         const result = await fromPromise(
            transaction.isPersisted.promise,
            (e) => e,
         );
         if (result.isErr()) {
            toast.error(getErrorMessage(result.error));
            return;
         }
         onCreated?.(row);
         toast.success("Categoria criada com sucesso.");
         closeTopSheet();
      },
   });

   return (
      <>
         <SheetHeader>
            <SheetTitle>Nova categoria</SheetTitle>
            <SheetDescription>
               Cadastre uma categoria de receita, despesa ou transferência.
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
                           const parsed = parseCategoryType(v);
                           if (!parsed) return;
                           field.handleChange(parsed);
                           form.setFieldValue("parentId", NO_PARENT_VALUE);
                           setIsSubcategory(false);
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
               {(selectedType) => (
                  <form.Field
                     name="parentId"
                     children={(field) => {
                        const parentOptions = categories.filter(
                           (c) =>
                              c.type === selectedType &&
                              c.level === 1 &&
                              !c.isArchived,
                        );
                        const options: AutocompleteOption[] = parentOptions.map(
                           (c) => ({
                              value: c.id,
                              label: c.name,
                              icon: c.icon ?? "briefcase",
                           }),
                        );
                        const selected = options.find(
                           (o) =>
                              !!field.state.value &&
                              field.state.value !== NO_PARENT_VALUE &&
                              o.value === field.state.value,
                        );

                        return (
                           <FieldGroup>
                              <Field orientation="horizontal">
                                 <FieldLabel htmlFor="is-subcategory">
                                    Subcategoria
                                 </FieldLabel>
                                 <Switch
                                    checked={isSubcategory}
                                    id="is-subcategory"
                                    onCheckedChange={(checked) => {
                                       setIsSubcategory(checked);
                                       if (!checked) {
                                          field.handleChange(NO_PARENT_VALUE);
                                          return;
                                       }
                                       field.handleChange("");
                                    }}
                                 />
                              </Field>
                              {isSubcategory ? (
                                 <Field>
                                    <FieldLabel htmlFor={field.name} required>
                                       Categoria pai
                                    </FieldLabel>
                                    <Autocomplete
                                       aria-invalid={isFieldInvalid(field)}
                                       emptyMessage="Nenhuma categoria encontrada."
                                       id={field.name}
                                       isLoading={false}
                                       name={field.name}
                                       options={options}
                                       placeholder="Buscar categoria..."
                                       renderOption={renderParentOption}
                                       value={selected}
                                       onValueChange={(opt) =>
                                          field.handleChange(opt.value)
                                       }
                                    />
                                 </Field>
                              ) : null}
                           </FieldGroup>
                        );
                     }}
                  />
               )}
            </form.Subscribe>

            <form.Subscribe selector={(s) => s.values.parentId}>
               {(parentId) => {
                  if (parentId && parentId !== NO_PARENT_VALUE) return null;

                  return (
                     <form.Field
                        name="icon"
                        children={(field) => (
                           <Field>
                              <FieldLabel htmlFor={field.name} required>
                                 Ícone
                              </FieldLabel>
                              <IconPicker
                                 id={field.name}
                                 value={field.state.value}
                                 onChange={field.handleChange}
                              />
                           </Field>
                        )}
                     />
                  );
               }}
            </form.Subscribe>

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
                        placeholder="Ex.: Aluguel"
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

            <form.Subscribe selector={(s) => s.values.parentId}>
               {(parentId) => {
                  if (parentId && parentId !== NO_PARENT_VALUE) return null;
                  return (
                     <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                        <CollapsibleTrigger asChild>
                           <Button
                              className="w-full justify-between"
                              type="button"
                              variant="ghost"
                           >
                              Mais opções
                              <ChevronDown
                                 className={cn(
                                    "size-4 transition-transform",
                                    moreOpen && "rotate-180",
                                 )}
                              />
                           </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="flex flex-col gap-4 pt-4">
                           <form.Field name="color">
                              {(field) => (
                                 <Field>
                                    <FieldLabel htmlFor={field.name}>
                                       Cor
                                    </FieldLabel>
                                    <ColorField
                                       id={field.name}
                                       value={field.state.value ?? null}
                                       onChange={field.handleChange}
                                    />
                                 </Field>
                              )}
                           </form.Field>
                        </CollapsibleContent>
                     </Collapsible>
                  );
               }}
            </form.Subscribe>
         </form>

         <SheetFooter>
            <SheetClose asChild>
               <Button variant="outline">Cancelar</Button>
            </SheetClose>
            <form.Subscribe
               selector={(s) => ({
                  canSubmit: s.canSubmit,
                  isSubmitting: s.isSubmitting,
               })}
            >
               {({ canSubmit, isSubmitting }) => (
                  <Button
                     disabled={!canSubmit || isSubmitting}
                     onClick={() => form.handleSubmit()}
                  >
                     Criar categoria
                  </Button>
               )}
            </form.Subscribe>
         </SheetFooter>
      </>
   );
}

function IconPicker({
   id,
   value,
   onChange,
}: {
   id: string;
   value: string;
   onChange: (value: string) => void;
}) {
   const [open, setOpen] = useState(false);
   const selected = CATEGORY_ICON_OPTIONS.find((o) => o.value === value);
   const SelectedIcon = selected?.icon ?? CATEGORY_ICON_MAP.briefcase;

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               aria-expanded={open}
               className="w-full justify-between"
               id={id}
               role="combobox"
               type="button"
               variant="outline"
            >
               <span className="flex items-center gap-2">
                  <SelectedIcon className="size-4" />
                  {selected?.label ?? "Selecionar ícone"}
               </span>
               <ChevronsUpDown className="size-4 opacity-50" />
            </Button>
         </PopoverTrigger>
         <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] p-0"
         >
            <Command>
               <CommandInput placeholder="Buscar ícone..." />
               <CommandList>
                  <CommandEmpty>Nenhum ícone encontrado.</CommandEmpty>
                  <CommandGroup>
                     {CATEGORY_ICON_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const checked = value === option.value;
                        return (
                           <CommandItem
                              key={option.value}
                              value={option.label}
                              onSelect={() => {
                                 onChange(option.value);
                                 setOpen(false);
                              }}
                           >
                              <Icon className="size-4" />
                              <span>{option.label}</span>
                              <Check
                                 className={cn(
                                    "ml-auto size-4",
                                    checked ? "opacity-100" : "opacity-0",
                                 )}
                              />
                           </CommandItem>
                        );
                     })}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}

function rgbaToHex(rgba: [number, number, number, number]) {
   const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
   return `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
}

function ColorField({
   id,
   value,
   onChange,
}: {
   id: string;
   value: string | null;
   onChange: (value: string) => void;
}) {
   const [open, setOpen] = useState(false);
   const display = value ?? "#000000";

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               className="w-full justify-between"
               id={id}
               type="button"
               variant="outline"
            >
               <span className="flex items-center gap-2">
                  <span
                     className="size-4 rounded-full border"
                     style={{ background: display }}
                  />
                  {display.toUpperCase()}
               </span>
               <ChevronsUpDown className="size-4 opacity-50" />
            </Button>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-72 p-4">
            <ColorPicker
               value={display}
               onChange={(rgba) => onChange(rgbaToHex(rgba))}
            >
               <ColorPickerSelection className="h-40" />
               <div className="flex items-center gap-4">
                  <ColorPickerEyeDropper />
                  <div className="flex w-full flex-col gap-4">
                     <ColorPickerHue />
                  </div>
               </div>
               <div className="flex items-center gap-2">
                  <ColorPickerOutput />
                  <ColorPickerFormat />
               </div>
            </ColorPicker>
         </PopoverContent>
      </Popover>
   );
}
