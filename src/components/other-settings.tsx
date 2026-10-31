import Link from "next/link";
import { Card } from "./ui";

/** Bottom of every settings page (ver_117): the two other places with settings, and who each one changes. */
export function OtherSettings({ admin }: { admin: boolean }) {
  return (
    <Card className="p-5" data-testid="other-settings">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">Other settings</h2>
      <div className="space-y-1.5 text-sm text-slate-600">
        <p>
          <Link href="/account" className="font-medium text-accent-700 hover:underline">
            Your account
          </Link>{" "}
          Only you: your name, picture, appearance, radio and password.
        </p>
        <p>
          {admin ? (
            <Link href="/workspace" className="font-medium text-accent-700 hover:underline">
              Workspace settings
            </Link>
          ) : (
            <span className="font-medium text-slate-800">Workspace settings</span>
          )}{" "}
          The whole company: sign-in, email, bug templates and the activity log. {admin ? "Only workspace admins see it." : "Only workspace admins can open it."}
        </p>
      </div>
    </Card>
  );
}
