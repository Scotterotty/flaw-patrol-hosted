"use server";

import { isVision } from "@/lib/vision";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { FRAMES, isUnlocked, levelFor, titleLabel, TITLES, totalXp } from "@/lib/game";
import { isRadioStation } from "@/lib/radio";
import { isSpotifyStation, KIND_LABEL, MAX_SPOTIFY_LINKS, parseSpotifyLinks, parseSpotifyUrl, SPOTIFY_PREFIX, spotifyKind, spotifyPage } from "@/lib/spotify";
import { gameStats } from "@/lib/xp";
import { fitsOf, isSlot, PAWN_COLORS, PAWNS, parseGear, pawnUnlocked } from "@/lib/quest-gear";
import { questRecordFor } from "@/lib/quest-data";
import { navOrderSchema } from "@/lib/nav-order";
import { isSpelling } from "@/lib/spelling";
import { isAccent, isBodyFont, isHeadingFont, isTextSize, isThemeMode } from "@/lib/theme";
import { attempt, UserError } from "./result";

const nameSchema = z.string().trim().min(1, "Enter your name").max(100);

/**
 * Change your own display name. Names are copied onto versions, runs, results
 * and defects when they're recorded, so those copies are renamed too.
 */
export async function updateMyName(name: string) {
  return attempt(async () => {
    const user = await requireUser();
    const n = nameSchema.parse(name);
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { name: n } }),
      db.caseVersion.updateMany({ where: { authorId: user.id }, data: { authorName: n } }),
      db.sharedStepVersion.updateMany({ where: { authorId: user.id }, data: { authorName: n } }),
      db.suiteVersion.updateMany({ where: { authorId: user.id }, data: { authorName: n } }),
      db.testRun.updateMany({ where: { createdById: user.id }, data: { createdBy: n } }),
      db.testResult.updateMany({ where: { testerId: user.id }, data: { testerName: n } }),
      db.defect.updateMany({ where: { createdById: user.id }, data: { createdBy: n } }),
    ]);
    revalidatePath("/", "layout");
    return {};
  });
}

export async function updateMyAppearance(a: { themeMode: string; accent: string; fontBody: string; fontHeading: string }) {
  return attempt(async () => {
    const user = await requireUser();
    if (!isThemeMode(a.themeMode) || !isAccent(a.accent) || !isBodyFont(a.fontBody) || !isHeadingFont(a.fontHeading)) throw new UserError("Unknown theme.");
    await db.user.update({ where: { id: user.id }, data: { themeMode: a.themeMode, accent: a.accent, fontBody: a.fontBody, fontHeading: a.fontHeading } });
    return {};
  });
}

/** US or UK English for the app's words and dates, just for you. */
export async function updateMySpelling(spelling: string) {
  return attempt(async () => {
    const user = await requireUser();
    if (!isSpelling(spelling)) throw new UserError("Pick US or UK English.");
    await db.user.update({ where: { id: user.id }, data: { spelling } });
    revalidatePath("/", "layout");
    return {};
  });
}

/** Text size and display aids. */
export async function updateMyAccessibility(a: { textSize: string; reduceMotion: boolean; strongContrast: boolean; underlineLinks: boolean; colorVision?: string; visionShapes?: boolean }) {
  return attempt(async () => {
    const user = await requireUser();
    if (!isTextSize(a.textSize)) throw new UserError("Unknown text size.");
    if (a.colorVision !== undefined && !isVision(a.colorVision)) throw new UserError("Unknown color vision choice.");
    await db.user.update({
      where: { id: user.id },
      data: {
        textSize: a.textSize,
        reduceMotion: !!a.reduceMotion,
        strongContrast: !!a.strongContrast,
        underlineLinks: !!a.underlineLinks,
        ...(a.colorVision !== undefined ? { colorVision: a.colorVision } : {}),
        ...(a.visionShapes !== undefined ? { visionShapes: !!a.visionShapes } : {}),
      },
    });
    return {};
  });
}

/** Turn the background radio on or off, or change station. */
export async function updateMyRadio(r: { enabled: boolean; station: string }) {
  return attempt(async () => {
    const user = await requireUser();
    const known = isRadioStation(r.station) || (isSpotifyStation(r.station) && parseSpotifyLinks(user.spotifyLinks).some((l) => SPOTIFY_PREFIX + l.id === r.station));
    if (!known) throw new UserError("Unknown station.");
    await db.user.update({ where: { id: user.id }, data: { radioEnabled: r.enabled, radioStation: r.station } });
    revalidatePath("/", "layout");
    return {};
  });
}

/** Spotify's public oEmbed endpoint gives the playlist or album title without signing in. */
async function spotifyTitle(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyPage(id))}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: unknown };
    return typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** Save a Spotify link to the radio and switch to it. */
export async function addSpotifyLink(raw: string) {
  return attempt(async () => {
    const user = await requireUser();
    const id = parseSpotifyUrl(z.string().max(500).parse(raw));
    if (!id) throw new UserError("That isn't a Spotify playlist, album, artist, song or podcast link. In Spotify, use Share > Copy link.");
    const links = parseSpotifyLinks(user.spotifyLinks);
    if (!links.some((l) => l.id === id)) {
      if (links.length >= MAX_SPOTIFY_LINKS) throw new UserError(`You can save up to ${MAX_SPOTIFY_LINKS} Spotify links. Remove one first.`);
      links.push({ id, name: (await spotifyTitle(id)) ?? `Spotify ${KIND_LABEL[spotifyKind(id)!].toLowerCase()}` });
    }
    await db.user.update({
      where: { id: user.id },
      data: { spotifyLinks: links as Prisma.InputJsonValue, radioEnabled: true, radioStation: SPOTIFY_PREFIX + id },
    });
    revalidatePath("/", "layout");
    return { links };
  });
}

export async function removeSpotifyLink(id: string) {
  return attempt(async () => {
    const user = await requireUser();
    const links = parseSpotifyLinks(user.spotifyLinks).filter((l) => l.id !== id);
    const station = user.radioStation === SPOTIFY_PREFIX + id ? "fluid" : user.radioStation;
    await db.user.update({ where: { id: user.id }, data: { spotifyLinks: links as Prisma.InputJsonValue, radioStation: station } });
    revalidatePath("/", "layout");
    return { links };
  });
}

/** Join or leave the mini game, or pick a title and avatar frame you've unlocked. */
export async function updateMyGame(g: { enabled: boolean; title: string | null; frame: string | null }) {
  return attempt(async () => {
    const user = await requireUser();
    // A crown (ver_96) is worn through wearCrown, which checks you still hold it.
    if (g.title?.startsWith("crown|")) {
      if (g.title !== user.gameTitle) throw new UserError("Pick the crown in Crowns you hold.");
    } else if (g.title || g.frame) {
      const stats = await gameStats(user.id);
      const { level } = levelFor(totalXp(stats));
      const title = TITLES.find((t) => t.id === g.title);
      const frame = FRAMES.find((f) => f.id === g.frame);
      if (g.title && !(title && isUnlocked(title.unlock, stats, level))) throw new UserError("You haven't unlocked that title yet.");
      if (g.frame && !(frame && isUnlocked(frame.unlock, stats, level))) throw new UserError("You haven't unlocked that frame yet.");
    }
    // Joining for the first time wears your first title, so it shows next to your name straight away.
    const autoTitle = g.enabled && !user.gameEnabled && !g.title && !user.gameTitle ? "rookie" : null;
    const title = autoTitle ?? g.title;
    await db.user.update({ where: { id: user.id }, data: { gameEnabled: g.enabled, gameTitle: title, gameFrame: g.frame, ...(!title?.startsWith("crown|") && { gameTitleBefore: null }) } });
    revalidatePath("/", "layout");
    return { autoTitle: autoTitle && titleLabel(autoTitle) };
  });
}

/** Wear a crown you hold (ver_96). Losing it later puts back the title you wore before. */
export async function wearCrown(titleId: string) {
  return attempt(async () => {
    const user = await requireUser();
    const [, groupId, key] = titleId.split("|");
    const held = await db.crown.findFirst({ where: { groupId, key, userId: user.id } });
    if (!held) throw new UserError("Someone else holds that crown now.");
    const before = user.gameTitle?.startsWith("crown|") ? user.gameTitleBefore : user.gameTitle;
    await db.user.update({ where: { id: user.id }, data: { gameEnabled: true, gameTitle: titleId, gameTitleBefore: before ?? null } });
    revalidatePath("/", "layout");
    return {};
  });
}

/** The crown toasts showed (ver_96): remember what you hold now, so they don't show again. */
export async function ackCrowns(held: string[]) {
  return attempt(async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { crownsSeen: held.slice(0, 200) } });
    return {};
  });
}

/** Show or hide quest maps, and the Quest map item in each project's menu. */
export async function setQuestMap(enabled: boolean) {
  return attempt(async () => {
    const user = await requireUser();
    // Quest maps are part of the mini game, so turning them on turns it on too.
    await db.user.update({
      where: { id: user.id },
      data: enabled ? { questMap: true, gameEnabled: true, ...(!user.gameEnabled && !user.gameTitle && { gameTitle: "rookie" }) } : { questMap: false },
    });
    revalidatePath("/", "layout");
    return {};
  });
}

/** Wear an item from your satchel in a slot, or take it off (itemId null). Looks only. */
export async function setQuestGear(slot: string, itemId: string | null) {
  return attempt(async () => {
    const user = await requireUser();
    if (!isSlot(slot)) throw new UserError("Unknown slot.");
    const gear = parseGear(user.questGear);
    // Slots changed by hand stop being "auto", and any slot emptied by hand never fills on its own again.
    const changed = new Set<string>([slot]);
    const emptied = new Set<string>();
    if (itemId) {
      if (!fitsOf(itemId).includes(slot)) throw new UserError("That item doesn't fit there.");
      const rec = await questRecordFor(user.id);
      if (!rec.items.has(itemId)) throw new UserError("That item isn't in your satchel.");
      // One item can only be worn in one place at a time.
      for (const s of Object.keys(gear) as (keyof typeof gear)[])
        if (gear[s] === itemId && s !== slot) {
          delete gear[s];
          changed.add(s);
          emptied.add(s);
        }
      gear[slot] = itemId;
    } else {
      delete gear[slot];
      emptied.add(slot);
    }
    await db.user.update({
      where: { id: user.id },
      data: {
        questGear: gear,
        questGearTouched: [...new Set([...user.questGearTouched, ...emptied])],
        questGearAuto: user.questGearAuto.filter((s) => !changed.has(s)),
      },
    });
    revalidatePath("/", "layout");
    return {};
  });
}

/** Choose your quest pawn and its color. The last four pawns unlock from the quests themselves. */
export async function setQuestPawn(pawn: string, color: string) {
  return attempt(async () => {
    const user = await requireUser();
    if (!PAWNS.some((p) => p.id === pawn)) throw new UserError("Unknown pawn.");
    if (!(PAWN_COLORS as readonly string[]).includes(color)) throw new UserError("Unknown color.");
    if (!pawnUnlocked(pawn, null) && !pawnUnlocked(pawn, await questRecordFor(user.id))) throw new UserError("You haven't unlocked that pawn yet.");
    if (pawn === "photo" && !user.avatarAt) throw new UserError("Add a profile picture first.");
    await db.user.update({ where: { id: user.id }, data: { questPawn: pawn, questColor: color } });
    revalidatePath("/", "layout");
    return {};
  });
}

const AVATAR_TYPES = ["image/webp", "image/png", "image/jpeg"];
const MAX_AVATAR = 300 * 1024;

/** The picture is cropped and shrunk in the browser before it's sent. */
export async function uploadAvatar(form: FormData) {
  return attempt(async () => {
    const user = await requireUser();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a picture.");
    if (!AVATAR_TYPES.includes(file.type)) throw new UserError("Use a PNG, JPEG or WebP picture.");
    if (file.size > MAX_AVATAR) throw new UserError("That picture is too large.");
    await db.user.update({ where: { id: user.id }, data: { avatar: new Uint8Array(await file.arrayBuffer()), avatarType: file.type, avatarAt: new Date() } });
    revalidatePath("/", "layout");
    return {};
  });
}

export async function removeAvatar() {
  return attempt(async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { avatar: null, avatarType: null, avatarAt: null, ...(user.questPawn === "photo" && { questPawn: "classic" }) } });
    revalidatePath("/", "layout");
    return {};
  });
}

/** Arrange menu order (ver_93): your own order for the left menu links. An empty order is the default. */
export async function saveMyNavOrder(order: unknown) {
  return attempt(async () => {
    const user = await requireUser();
    const parsed = navOrderSchema.safeParse(order);
    if (!parsed.success) throw new UserError("That menu order couldn't be saved.");
    await db.user.update({ where: { id: user.id }, data: { navOrder: parsed.data as Prisma.InputJsonValue } });
    revalidatePath("/", "layout");
    return {};
  });
}

/** Which folding cards on Your account and Mini game sections stay open (ver_96). */
export async function setOpenCards(ids: string[]) {
  return attempt(async () => {
    const user = await requireUser();
    const clean = [...new Set(ids.filter((x) => typeof x === "string" && /^[a-z]+:[a-z-]+$/.test(x)))].slice(0, 40);
    await db.user.update({ where: { id: user.id }, data: { openCards: clean } });
    return {};
  });
}
