import { parseSpotifyLinks, validStation } from "@/lib/spotify";
import { isSpelling } from "@/lib/spelling";
import { viewerZone } from "@/lib/zone-server";
import { ACCENTS, fontFor, isAccent, isBodyFont, isHeadingFont, isTextSize, isThemeMode, TEXT_SIZES, THEME_MODES, THEMES } from "@/lib/theme";
import { levelFor, titleLabel, totalXp } from "@/lib/game";
import { gameStats } from "@/lib/xp";
import { longDate, spellingFor } from "@/lib/spelling";
import { AccessibilitySettings, EasyReadFont } from "./accessibility";
import type { ReactNode } from "react";
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
import { PaneSizesReset } from "./pane-sizes-reset";
import { RadioSettings } from "./radio-settings";
import { SpinnerPicker } from "./spinner-picker";
import { RiskLookPicker } from "./risk-look-picker";
import { isRiskLook, riskLookLabel } from "@/lib/risk-looks";
import { cleanLook, LOOKS } from "@/lib/looks";
import { cleanSpinners, pawnEmoji, SPINNER_FOLD } from "@/lib/spinners";

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
  riskLook?: string | null;
  look?: string;
  questPawn?: string;
  digestPrefs?: unknown;
};

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
    cleanLook(user.look) !== "classic" ? `${LOOKS.find((l) => l.id === cleanLook(user.look))!.label} look` : "",
    THEMES.some((t) => t.id === user.accent) ? label(THEMES, user.accent) : label(ACCENTS, user.accent),
    label(THEME_MODES, user.themeMode),
    `${fontFor(user.fontBody)?.label ?? "Poppins"} and ${user.fontHeading === "body" ? "the same for headings" : (fontFor(user.fontHeading)?.label ?? "Bungee")}`,
    user.riskLook && isRiskLook(user.riskLook) && user.riskLook !== cleanLook(user.look) ? `${riskLookLabel(user.riskLook)} Risk board` : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
      {/* ver_200: four groups, so Accessibility sits next to Appearance and the fun extras stay out of the way. */}
      <div className="space-y-6">
        <AccountGroup title="You">
          <AccountCard
            id="profile"
            howto="account-profile"
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
          <AccountCard id="password" howto="account-password" title="Password" summary={user.passwordSetAt ? `Set · last changed ${longDate(user.passwordSetAt, spelling)}` : "Not set yet"}>
            <ChangePasswordForm hasPassword={!!user.passwordSetAt} />
          </AccountCard>
          <AccountCard id="jira" howto="account-jira" title="Jira" summary={user.jiraEmail ? `Uses ${user.jiraEmail}` : "Uses your sign-in email"}>
            <JiraEmailForm jiraEmail={user.jiraEmail} email={user.email} />
          </AccountCard>
        </AccountGroup>
        <AccountGroup title="How it looks">
          <AccountCard id="appearance" title="Appearance" summary={appearance}>
            <AppearancePicker
              shapes={shapesOn(user.colorVision, user.visionShapes)}
              initial={{
                look: cleanLook(user.look),
                themeMode: isThemeMode(user.themeMode) ? user.themeMode : "light",
                accent: isAccent(user.accent) ? user.accent : "violet",
                fontBody: isBodyFont(user.fontBody) ? user.fontBody : "poppins",
                fontHeading: isHeadingFont(user.fontHeading) ? user.fontHeading : "bungee",
              }}
            />
            <div className="mt-5">
              <RiskLookPicker initial={user.riskLook && isRiskLook(user.riskLook) ? user.riskLook : "same"} />
            </div>
          </AccountCard>
          <AccountCard id="accessibility" howto="account-accessibility" title="Accessibility" summary={access}>
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
            <div className="mt-5 border-t border-slate-100 pt-4">
              <EasyReadFont body={isBodyFont(user.fontBody) ? user.fontBody : "poppins"} heading={user.fontHeading} />
            </div>
          </AccountCard>
          <AccountCard id="language" howto="account-language" title="Language" summary={`${spelling === "uk" ? "UK English" : "US English"} · dates like ${sample}`}>
            <LanguageSettings mine={isSpelling(user.spelling) ? user.spelling : null} />
          </AccountCard>
          <AccountCard id="layout" howto="account-layout" title="Layout" summary="Menu order · panel sizes">
            <MenuOrderReset />
            <PaneSizesReset />
          </AccountCard>
        </AccountGroup>
        <AccountGroup title="Emails I get">
          <AccountCard id="emails" howto="account-emails" title="Emails I get" summary={prefsSummary(parsePrefs(user.digestPrefs))}>
            <DigestPrefsForm initial={parsePrefs(user.digestPrefs)} />
          </AccountCard>
        </AccountGroup>
        <AccountGroup title="Just for fun">
          <AccountCard
            id="game"
            title="Mini game"
            summary={user.gameEnabled ? [`Level ${level}`, titleLabel(user.gameTitle) ? `wearing ${titleLabel(user.gameTitle)}` : "", `quest maps ${user.questMap ? "on" : "off"}`].filter(Boolean).join(" · ") : "Off"}
          >
            <GameCard user={user} stats={stats} />
          </AccountCard>
          <AccountCard id="radio" howto="account-radio" title="Radio" summary={user.radioEnabled ? "On" : "Off"}>
            <RadioSettings enabled={user.radioEnabled} station={validStation(user.radioStation, parseSpotifyLinks(user.spotifyLinks))} spotify={parseSpotifyLinks(user.spotifyLinks)} />
          </AccountCard>
          <SpinnerPicker card initial={cleanSpinners(user.spinners)} pawn={pawnEmoji(user.questPawn)} />
        </AccountGroup>
      </div>
    </OpenCardsProvider>
  );
}

const CARDS = ["profile", "password", "jira", "appearance", "accessibility", "language", "layout", "emails", "game", "radio"];

/** A small heading over a group of account cards. */
function AccountGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}
