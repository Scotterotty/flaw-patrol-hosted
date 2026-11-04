import { orList } from "@/lib/link-access";

/**
 * Members lists are for Admins only (ver_168). Everyone else gets this one line instead,
 * so "who do I ask to add a teammate or change a role?" still has an answer.
 */
export function AskAdminLine({ admins, className = "" }: { admins: string[]; className?: string }) {
  if (!admins.length) return null;
  return (
    <p data-testid="ask-admin" className={`text-sm text-slate-500 ${className}`}>
      Need someone added or a role changed? Ask an Admin: {orList(admins)}.
    </p>
  );
}
