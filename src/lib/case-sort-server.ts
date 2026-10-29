import "server-only";
import { cookies } from "next/headers";
import { CASE_SORT_COOKIE, parseCaseSort } from "./case-sort";

export async function readCaseSort() {
  return parseCaseSort((await cookies()).get(CASE_SORT_COOKIE)?.value);
}
