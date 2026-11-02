import { shapesOn } from "@/lib/vision";
import type { Metadata } from "next";
import { RadioProvider } from "@/components/radio-player";
import { SpellingProvider } from "@/components/spelling";
import { currentUser, mySpelling } from "@/lib/session";
import { parseSpotifyLinks, validStation } from "@/lib/spotify";
import { fontVars } from "@/lib/theme";
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
import { QuestToaster } from "@/components/quest-toast";
import { CrownToaster } from "@/components/crown-toast";
import { crownChanges } from "@/lib/crowns";
import { SkipLink } from "@/components/skip-link";
import { WhatsNewWindow } from "@/components/whats-new";
import { BUILD, unseenFor } from "@/lib/whats-new";
import { viewerOf } from "@/lib/whats-new-viewer";
import { NavOrderProvider } from "@/components/nav-order";
import { parseNavOrder } from "@/lib/nav-order";
import { GlossaryProvider } from "@/components/glossary";
import { BusyCorner } from "@/components/busy-corner";
import { ZoneCookie } from "@/components/zone-cookie";
import { viewerZone } from "@/lib/zone-server";

export const metadata: Metadata = { title: { default: "Flaw Patrol", template: "%s · Flaw Patrol" } };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed-out pages follow the computer's light or dark setting.
  const user = await currentUser();
  const spotify = parseSpotifyLinks(user?.spotifyLinks);
  const spelling = await mySpelling();
  // Your time zone (ver_137), saved by your browser, so server-drawn times are on your clock.
  const zone = await viewerZone();
  // What's new after sign-in (ver_88): versions this person hasn't closed yet.
  const whatsNew = user && (user.whatsNewSeen ?? 0) < BUILD ? unseenFor(user.whatsNewSeen, await viewerOf(user)) : [];
  // Mini game crowns (ver_96): tell players once when they take or lose one.
  const crowns = user?.gameEnabled ? await crownChanges(user).catch(() => null) : null;
  return (
    <html
      // en-GB also switches the browser's spell checker to British English.
      lang={spelling === "uk" ? "en-GB" : "en-US"}
      data-theme={user?.themeMode ?? "system"}
      data-accent={user?.accent ?? "violet"}
      data-font-body={user?.fontBody ?? "poppins"}
      data-font-heading={user?.fontHeading ?? "bungee"}
      data-text-size={user?.textSize ?? "100"}
      data-motion={user?.reduceMotion ? "reduce" : undefined}
      data-contrast={user?.strongContrast ? "more" : undefined}
      data-links={user?.underlineLinks ? "underline" : undefined}
      // Color vision (ver_96): another status palette, and shapes and patterns on statuses.
      data-vision={user && user.colorVision !== "standard" ? user.colorVision : undefined}
      data-shapes={user && shapesOn(user.colorVision, user.visionShapes) ? "on" : undefined}
      // Loading spinners (ver_108): the ones you ticked, and your quest pawn for Pawn hop.
      data-spinners={cleanSpinners(user?.spinners).join(" ")}
      data-pawn={pawnEmoji(user?.questPawn)}
      style={fontVars(user?.fontBody ?? "poppins", user?.fontHeading ?? "bungee")}
    >
      <body className="min-h-screen font-sans antialiased">
        <SkipLink />
        <SpellingProvider spelling={spelling} zone={zone}>
          <ZoneCookie zone={zone} />
          <NavOrderProvider order={parseNavOrder(user?.navOrder)}>
          {/* The radio is up here so it keeps playing from page to page and project to project. */}
          {(() => {
            const page = user?.radioEnabled ? (
              <RadioProvider initialStation={validStation(user.radioStation, spotify)} spotify={spotify}>
                {children}
              </RadioProvider>
            ) : (
              children
            );
            // Glossary (ver_113): underlines and Look it up on every page once you're signed in.
            return user ? <GlossaryProvider underline={user.glossaryUnderline}>{page}</GlossaryProvider> : page;
          })()}
          {user?.gameEnabled && user.questMap && <QuestToaster />}
          {crowns && crowns.changes.length > 0 && <CrownToaster changes={crowns.changes} />}
          {/* Your spinner whenever something takes more than a third of a second (ver_116). */}
          <BusyCorner />
          {whatsNew.length > 0 && <WhatsNewWindow entries={whatsNew} />}
          </NavOrderProvider>
        </SpellingProvider>
      </body>
    </html>
  );
}
