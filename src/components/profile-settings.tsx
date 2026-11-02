import { parseSpotifyLinks, validStation } from "@/lib/spotify";
import { isSpelling } from "@/lib/spelling";
import { viewerZone } from "@/lib/zone-server";
import { ACCENTS, fontFor, isAccent, isBodyFont, isHeadingFont, isTextSize, isThemeMode, TEXT_SIZES, THEME_MODES, THEMES } from "@/lib/theme";
import { levelFor, titleLabel, totalXp } from "@/lib/game";
import { gameStats } from "@/lib/xp";
import { longDate, spellingFor } from "@/lib/spelling";
import { AccessibilitySettings } from "./accessibility";
import { isVision, shapesOn, VISIONS } from "@/lib/vision";
import { Avatar } from "./avatar";
import { AccountCard, OpenAllButton, OpenCardsProvider } from "./open-cards";
import { AccountForm } from "./account-form";
import { AppearancePicker } from "./appearance";
import { AvatarUpload } from "./avatar-upload";
import { ChangePasswordForm } from "./change-password";
import { GameCard } from "./game-card";
import { JiraEmailForm } from "./jira-email";
import { DigestPrefsForm } from "./digest-prefs";
import { parsePrefs, prefsSummary } from "@/lib/digest-settings";
import { LanguageSettings } from "./language-settings";
import { MenuOrderReset } from "./menu-order-reset";
import { RadioSettings } from "./radio-settings";
import { SpinnerPicker } from "./spinner-picker";
import { cleanSpinners, pawnEmoji, SPINNER_FOLD, SPINNERS } from "@/lib/spinners";

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
  colorVision: string;
  visionShapes: boolean;
  radioEnabled: boolean;
  radioStation: string;
  spotifyLinks: unknown;
  gameEnabled: boolean;
  gameTitle: string | null;
  gameFrame: string | null;
  questMap?: boolean;
  seasonalMaps?: boolean;
  textSize: string;
  reduceMotion: boolean;
  strongContrast: boolean;
  underlineLinks: boolean;
  spelling: string | null;
  isAdmin: boolean;
  openCards?: string[];
  spinners?: string[];
  questPawn?: string;
  digestPrefs?: unknown;
};

const spinnerSummary = (ids: string[]) => (ids.length === 1 ? `${SPINNERS.find((s) => s.id === ids[0])?.label ?? "Plain ring"} spinner` : `${ids.length} spinners`);

const label = <T extends { id: string; label: string }>(list: readonly T[], id: string) => list.find((x) => x.id === id)?.label ?? id;

/**
 * Your picture, name, theme, language and password, on /account. Every card folds to one
 * line that says what you have set; what you leave open is saved on your account.
 */
export async function ProfileSettings({ user }: { user: Me }) {
  const spelling = spellingFor(user.spelling);
  const stats = user.gameEnabled ? await gameStats(user.id) : null;
  const level = stats ? levelFor(totalXp(stats)).level : 0;
  const appearance = [
    THEMES.some((t) => t.id === user.accent) ? label(THEMES, user.accent) : label(ACCENTS, user.accent),
    label(THEME_MODES, user.themeMode),
    `${fontFor(user.fontBody)?.label ?? "Poppins"} and ${user.fontHeading === "body" ? "the same for headings" : (fontFor(user.fontHeading)?.label ?? "Bungee")}`,
    spinnerSummary(cleanSpinners(user.spinners)),
  ].join(" · ");
  const aids = [user.strongContrast && "stronger contrast", user.underlineLinks && "underlined links", user.reduceMotion && "less motion"].filter(Boolean);
  const vision = VISIONS.find((v) => v.id === user.colorVision);
  const access = [
    `${label(TEXT_SIZES, user.textSize)} text`,
    vision && vision.id !== "standard" ? vision.label : "",
    shapesOn(user.colorVision, user.visionShapes) ? "shapes on" : "",
    ...aids,
  ]
    .filter(Boolean)
    .join(" · ");
  const sample = longDate(new Date(), spelling, await viewerZone());
  return (
    <OpenCardsProvider initial={user.openCards ?? []}>
      <div className="mb-3 flex justify-end">
        <OpenAllButton ids={[...CARDS.map((c) => `acct:${c}`), SPINNER_FOLD]} />
      </div>
      <div className="space-y-3">
        <AccountCard
          id="profile"
          title="Your profile"
          summary={
            <span className="inline-flex items-center gap-1.5">
              <Avatar person={user} size={18} />
              {user.name || "No name yet"} · {user.avatarAt ? "picture set" : "no picture"}
            </span>
          }
        >
          <p className="mb-4 text-xs text-slate-500">Signed in as {user.email}</p>
          <div className="space-y-5">
            <AvatarUpload person={user} />
            <AccountForm name={user.name ?? ""} />
          </div>
        </AccountCard>
        <AccountCard id="appearance" title="Appearance" summary={appearance}>
          <AppearancePicker
            initial={{
              themeMode: isThemeMode(user.themeMode) ? user.themeMode : "light",
              accent: isAccent(user.accent) ? user.accent : "violet",
              fontBody: isBodyFont(user.fontBody) ? user.fontBody : "poppins",
              fontHeading: isHeadingFont(user.fontHeading) ? user.fontHeading : "bungee",
            }}
          />
          <div className="mt-5">
            <SpinnerPicker initial={cleanSpinners(user.spinners)} pawn={pawnEmoji(user.questPawn)} />
          </div>
          <div className="mt-5">
            <MenuOrderReset />
          </div>
        </AccountCard>
        <AccountCard id="language" title="Language" summary={`${spelling === "uk" ? "UK English" : "US English"} · dates like ${sample}`}>
          <LanguageSettings mine={isSpelling(user.spelling) ? user.spelling : null} />
        </AccountCard>
        <AccountCard id="jira" title="Jira" summary={user.jiraEmail ? `Uses ${user.jiraEmail}` : "Uses your sign-in email"}>
          <JiraEmailForm jiraEmail={user.jiraEmail} email={user.email} />
        </AccountCard>
        <AccountCard id="emails" title="Emails I get" summary={prefsSummary(parsePrefs(user.digestPrefs))}>
          <DigestPrefsForm initial={parsePrefs(user.digestPrefs)} />
        </AccountCard>
        <AccountCard id="accessibility" title="Accessibility" summary={access}>
          <AccessibilitySettings
            initial={{
              textSize: isTextSize(user.textSize) ? user.textSize : "100",
              reduceMotion: user.reduceMotion,
              strongContrast: user.strongContrast,
              underlineLinks: user.underlineLinks,
              colorVision: isVision(user.colorVision) ? user.colorVision : "standard",
              visionShapes: user.visionShapes,
            }}
          />
        </AccountCard>
        <AccountCard
          id="game"
          title="Mini game"
          summary={user.gameEnabled ? [`Level ${level}`, titleLabel(user.gameTitle) ? `wearing ${titleLabel(user.gameTitle)}` : "", `quest maps ${user.questMap ? "on" : "off"}`].filter(Boolean).join(" · ") : "Off"}
        >
          <GameCard user={user} stats={stats} />
        </AccountCard>
        <AccountCard id="radio" title="Radio" summary={user.radioEnabled ? "On" : "Off"}>
          <RadioSettings enabled={user.radioEnabled} station={validStation(user.radioStation, parseSpotifyLinks(user.spotifyLinks))} spotify={parseSpotifyLinks(user.spotifyLinks)} />
        </AccountCard>
        <AccountCard id="password" title="Password" summary={user.passwordSetAt ? `Set · last changed ${longDate(user.passwordSetAt, spelling)}` : "Not set yet"}>
          <ChangePasswordForm hasPassword={!!user.passwordSetAt} />
        </AccountCard>
      </div>
    </OpenCardsProvider>
  );
}

const CARDS = ["profile", "appearance", "language", "jira", "emails", "accessibility", "game", "radio", "password"];
