import { Button } from "@packages/ui/components/button";
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from "@packages/ui/components/select";
import type { Table } from "@tanstack/react-table";
import {
   ChevronFirst,
   ChevronLast,
   ChevronLeft,
   ChevronRight,
} from "lucide-react";

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100];

interface DataTablePaginationProps<TData> {
   table: Table<TData>;
   totalRows?: number;
   pageSizes?: number[];
}

export function DataTablePagination<TData>({
   table,
   pageSizes = DEFAULT_PAGE_SIZES,
   totalRows,
}: DataTablePaginationProps<TData>) {
   const { pageIndex, pageSize } = table.getState().pagination;
   const total = totalRows ?? table.getRowCount();
   const pageCount = table.getPageCount();
   const from = total === 0 ? 0 : pageIndex * pageSize + 1;
   const to = Math.min((pageIndex + 1) * pageSize, total);

   return (
      <div className="flex flex-wrap items-center gap-4 justify-between text-sm">
         <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Linhas por página</span>
            <Select
               onValueChange={(v) => table.setPageSize(Number(v))}
               value={String(pageSize)}
            >
               <SelectTrigger className="h-8 w-20">
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {pageSizes.map((size) => (
                     <SelectItem key={size} value={String(size)}>
                        {size}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
         </div>
         <div className="text-muted-foreground">
            {from}–{to} de {total}
         </div>
         <div className="flex items-center gap-2">
            <Button
               disabled={!table.getCanPreviousPage()}
               onClick={() => table.setPageIndex(0)}
               size="icon-sm"
               tooltip="Primeira página"
               type="button"
               variant="outline"
            >
               <ChevronFirst />
            </Button>
            <Button
               disabled={!table.getCanPreviousPage()}
               onClick={() => table.previousPage()}
               size="icon-sm"
               tooltip="Página anterior"
               type="button"
               variant="outline"
            >
               <ChevronLeft />
            </Button>
            <span className="px-2 text-muted-foreground">
               {pageIndex + 1} / {Math.max(pageCount, 1)}
            </span>
            <Button
               disabled={!table.getCanNextPage()}
               onClick={() => table.nextPage()}
               size="icon-sm"
               tooltip="Próxima página"
               type="button"
               variant="outline"
            >
               <ChevronRight />
            </Button>
            <Button
               disabled={!table.getCanNextPage()}
               onClick={() => table.setPageIndex(pageCount - 1)}
               size="icon-sm"
               tooltip="Última página"
               type="button"
               variant="outline"
            >
               <ChevronLast />
            </Button>
         </div>
      </div>
   );
}
