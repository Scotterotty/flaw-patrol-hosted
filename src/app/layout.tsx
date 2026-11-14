import { shapesOn } from "@/lib/vision";
import type { Metadata } from "next";
import { RadioProvider } from "@/components/radio-player";
import { SpellingProvider } from "@/components/spelling";
import { currentUser, mySpelling } from "@/lib/session";
import { firstDay } from "@/lib/first-day";
import { parseSpotifyLinks, validStation } from "@/lib/spotify";
import { lookAttrs } from "@/lib/looks";
import { cleanSpinners, pawnEmoji } from "@/lib/spinners";
import "@fontsource/young-serif/400.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/500.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/700.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/500.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/quicksand/400.css";
import "@fontsource/quicksand/500.css";
import "@fontsource/quicksand/600.css";
import "@fontsource/quicksand/700.css";
import "@fontsource/comic-neue/400.css";
import "@fontsource/comic-neue/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/righteous/400.css";
import "@fontsource/lobster/400.css";
import "@fontsource/caveat/700.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/bungee/400.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/500.css";
import "@fontsource/work-sans/600.css";
import "@fontsource/work-sans/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/600.css";
import "@fontsource/roboto/700.css";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "@fontsource/cooper-hewitt/400.css";
import "@fontsource/cooper-hewitt/500.css";
import "@fontsource/cooper-hewitt/600.css";
import "@fontsource/cooper-hewitt/700.css";
import "@fontsource/aileron/400.css";
import "@fontsource/aileron/600.css";
import "@fontsource/aileron/700.css";
import "@fontsource/libre-baskerville/400.css";
import "@fontsource/libre-baskerville/700.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/eb-garamond/700.css";
import "@fontsource/oswald/600.css";
import "@fontsource/league-gothic/400.css";
import "@fontsource/ostrich-sans/900.css";
import "@fontsource/bluu-next/700.css";
import "@fontsource/bagnard/400.css";
import "@fontsource/lexend/600.css";
import "./globals.css";
import "./risk-looks.css";
import "./looks.css";
import { QuestToaster } from "@/components/quest-toast";
import { SisterToaster } from "@/components/sister-toast";
import { CrownToaster } from "@/components/crown-toast";
import { crownChanges } from "@/lib/crowns";
import { SkipLink } from "@/components/skip-link";
import { WhatsNewWindow } from "@/components/whats-new";
import { BUILD, unseenFor } from "@/lib/whats-new";
import { viewerOf } from "@/lib/whats-new-viewer";
import { NavOrderProvider } from "@/components/nav-order";
import { KeptOwnerProvider } from "@/components/kept-draft";
import { parseNavOrder } from "@/lib/nav-order";
import { GlossaryProvider } from "@/components/glossary";
import { BusyCorner } from "@/components/busy-corner";
import { ZoneCookie } from "@/components/zone-cookie";
import { viewerZone } from "@/lib/zone-server";
import { db } from "@/lib/db";
import { HowToGuide } from "@/components/how-to-guide";

export const metadata: Metadata = { title: { default: "Flaw Patrol", template: "%s · Flaw Patrol" } };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed-out pages follow the computer's light or dark setting.
  const user = await currentUser();
  const spotify = parseSpotifyLinks(user?.spotifyLinks);
  const spelling = await mySpelling();
  // Your time zone, saved by your browser, so server-drawn times are on your clock.
  const zone = await viewerZone();
  // Remember it on the account too, so digest emails show their own clock (ver_197).
  if (user && zone !== "UTC" && user.timeZone !== zone) void db.user.update({ where: { id: user.id }, data: { timeZone: zone } }).catch(() => {});
  // What's new after sign-in: versions this person hasn't closed yet.
  const whatsNew = user && (user.whatsNewSeen ?? 0) < BUILD ? unseenFor(user.whatsNewSeen, await viewerOf(user)) : [];
  // Mini game crowns: tell players once when they take or lose one.
  const crowns = user?.gameEnabled ? await crownChanges(user).catch(() => null) : null;
  // Your look (Classic, Mission control…) sits on top of mode, color and fonts (ver_202).
  const looks = lookAttrs(user?.look, {
    themeMode: user?.themeMode ?? "system",
    accent: user?.accent ?? "violet",
    fontBody: user?.fontBody ?? "poppins",
    fontHeading: user?.fontHeading ?? "bungee",
    shapes: !!user && shapesOn(user.colorVision, user.visionShapes),
  });
  return (
    <html
      // en-GB also switches the browser's spell checker to British English.
      lang={spelling === "uk" ? "en-GB" : "en-US"}
      data-look={looks.look === "classic" ? undefined : looks.look}
      data-theme={looks.theme}
      data-accent={looks.accent}
      data-font-body={user?.fontBody ?? "poppins"}
      data-font-heading={user?.fontHeading ?? "bungee"}
      data-text-size={user?.textSize ?? "100"}
      data-motion={user?.reduceMotion ? "reduce" : undefined}
      data-contrast={user?.strongContrast ? "more" : undefined}
      data-links={user?.underlineLinks ? "underline" : undefined}
      // Color vision: another status palette, and shapes and patterns on statuses.
      data-vision={user && user.colorVision !== "standard" ? user.colorVision : undefined}
      data-shapes={looks.shapes ? "on" : undefined}
      // Loading spinners: the ones you ticked, and your quest pawn for Pawn hop.
      data-spinners={cleanSpinners(user?.spinners).join(" ")}
      data-pawn={pawnEmoji(user?.questPawn)}
      style={looks.fonts as React.CSSProperties}
    >
      {/* Browser extensions (Testim, Grammarly…) add attributes to body before React loads; don't warn about those. */}
      <body className="min-h-screen font-sans antialiased" suppressHydrationWarning>
        <SkipLink />
        <SpellingProvider spelling={spelling} zone={zone}>
          <ZoneCookie zone={zone} />
          <NavOrderProvider order={parseNavOrder(user?.navOrder)}>
          {/* Keep what you're typing: drafts are filed under your sign-in. */}
          <KeptOwnerProvider owner={user?.id ?? ""}>
          {/* The radio is up here so it keeps playing from page to page and project to project. */}
          {(() => {
            const page = user?.radioEnabled ? (
              <RadioProvider initialStation={validStation(user.radioStation, spotify)} spotify={spotify}>
                {children}
              </RadioProvider>
            ) : (
              children
            );
            // Glossary: underlines and Look it up on every page once you're signed in.
            return user ? <GlossaryProvider underline={user.glossaryUnderline}>{page}</GlossaryProvider> : page;
          })()}
          {user?.gameEnabled && user.questMap && <QuestToaster />}
          {user && <SisterToaster />}
          {crowns && crowns.changes.length > 0 && <CrownToaster changes={crowns.changes} />}
          {/* Your spinner whenever something takes more than a third of a second. */}
          <BusyCorner />
          {whatsNew.length > 0 && <WhatsNewWindow entries={whatsNew} />}
          {/* The How-to guide: closed until someone opens it from the left menu or Search. */}
          {user && <HowToGuide startHidden={firstDay(user.openCards).startHidden} />}
          </KeptOwnerProvider>
          </NavOrderProvider>
        </SpellingProvider>
      </body>
    </html>
  );
}
