"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { removeAvatar, uploadAvatar } from "@/server/account";
import { Avatar, type AvatarPerson } from "./avatar";
import { Button, ErrorText } from "./ui";

const SIZE = 256;

/** Crop the middle square and shrink it to 256 px, as WebP (PNG where WebP isn't supported). */
async function squareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (blob?.type === "image/webp") return blob;
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that picture."))), "image/png"));
}

export function AvatarUpload({ person }: { person: AvatarPerson }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pick = (file: File) =>
    start(async () => {
      try {
        const blob = await squareImage(file);
        const form = new FormData();
        form.set("file", new File([blob], "avatar", { type: blob.type }));
        const res = await uploadAvatar(form);
        if (!res.ok) return setError(res.error);
        setError(null);
        router.refresh();
      } catch {
        setError("Couldn't read that picture. Try a PNG or JPEG.");
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar person={person} size={64} />
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => input.current?.click()}>
            {pending ? "Uploading…" : person.avatarAt ? "Change picture" : "Upload picture"}
          </Button>
          {person.avatarAt && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await removeAvatar();
                  router.refresh();
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500">Shown next to your name on assignments, results and history.</p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="Profile picture"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) pick(f);
        }}
      />
    </div>
  );
}
