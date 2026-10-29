"use client";

import { useRouter } from "next/navigation";
import { CASE_SORT_COOKIE, type CaseSort } from "@/lib/case-sort";
import { cx, Select } from "./ui";

/** Order a case list by the suite's order, by priority, or (in runs) by status. The choice sticks for suites, runs and the runner. */
export function CaseSortToggle({ value, orderLabel, className, statuses = false }: { value: CaseSort; orderLabel: string; className?: string; statuses?: boolean }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Sort cases"
      className={cx("h-8 w-auto text-xs", className)}
      value={value === "status" && !statuses ? "order" : value}
      onChange={(e) => {
        document.cookie = `${CASE_SORT_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      <option value="order">Sort: {orderLabel}</option>
      <option value="priority">Sort: Priority</option>
      {statuses && <option value="status">Sort: Status</option>}
    </Select>
  );
}
