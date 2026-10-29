import { parseSpotifyLinks, validStation } from "@/lib/spotify";
import { isSpelling } from "@/lib/spelling";
import { isAccent, isBodyFont, isHeadingFont, isTextSize, isThemeMode } from "@/lib/theme";
import { AccessibilitySettings } from "./accessibility";
import { AccountForm } from "./account-form";
import { AppearancePicker } from "./appearance";
import { AvatarUpload } from "./avatar-upload";
import { ChangePasswordForm } from "./change-password";
import { GameCard } from "./game-card";
import { JiraEmailForm } from "./jira-email";
import { LanguageSettings } from "./language-settings";
import { MenuOrderReset } from "./menu-order-reset";
import { RadioSettings } from "./radio-settings";
import { Card } from "./ui";

type Me = {
  id: string;
  email: string;
  jiraEmail: string | null;
  name: string | null;
  avatarAt: Date | null;
  passwordSetAt: Date | null;
  themeMode: string;
  accent: string;
  fontBody: string;
  fontHeading: string;
  radioEnabled: boolean;
  radioStation: string;
  spotifyLinks: unknown;
  gameEnabled: boolean;
  gameTitle: string | null;
  gameFrame: string | null;
  questMap?: boolean;
  textSize: string;
  reduceMotion: boolean;
  strongContrast: boolean;
  underlineLinks: boolean;
  spelling: string | null;
  isAdmin: boolean;
};

/** Your picture, name, theme, language and password, on /account. */
export function ProfileSettings({ user }: { user: Me }) {
  return (
    <>
      <Card id="profile" className="scroll-mt-28 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Your profile</h2>
        <p className="mb-4 text-xs text-slate-500">Signed in as {user.email}</p>
        <div className="space-y-5">
          <AvatarUpload person={user} />
          <AccountForm name={user.name ?? ""} />
        </div>
      </Card>
      <Card id="appearance" className="scroll-mt-28 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Appearance</h2>
        <AppearancePicker
          initial={{
            themeMode: isThemeMode(user.themeMode) ? user.themeMode : "light",
            accent: isAccent(user.accent) ? user.accent : "violet",
            fontBody: isBodyFont(user.fontBody) ? user.fontBody : "poppins",
            fontHeading: isHeadingFont(user.fontHeading) ? user.fontHeading : "bungee",
          }}
        />
        <div className="mt-5">
          <MenuOrderReset />
        </div>
      </Card>
      <Card id="language" className="scroll-mt-28 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Language</h2>
        <LanguageSettings mine={isSpelling(user.spelling) ? user.spelling : null} />
      </Card>
      <Card id="jira" className="scroll-mt-28 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Jira</h2>
        <JiraEmailForm jiraEmail={user.jiraEmail} email={user.email} />
      </Card>
      <Card id="accessibility" className="scroll-mt-28 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Accessibility</h2>
        <AccessibilitySettings
          initial={{
            textSize: isTextSize(user.textSize) ? user.textSize : "100",
            reduceMotion: user.reduceMotion,
            strongContrast: user.strongContrast,
            underlineLinks: user.underlineLinks,
          }}
        />
      </Card>
      <Card id="game" className="scroll-mt-28 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Mini game</h2>
        <GameCard user={user} />
      </Card>
      <Card id="radio" className="scroll-mt-28 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Radio</h2>
        <RadioSettings enabled={user.radioEnabled} station={validStation(user.radioStation, parseSpotifyLinks(user.spotifyLinks))} spotify={parseSpotifyLinks(user.spotifyLinks)} />
      </Card>
      <Card id="password" className="scroll-mt-28 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Password</h2>
        <ChangePasswordForm hasPassword={!!user.passwordSetAt} />
      </Card>
    </>
  );
}
