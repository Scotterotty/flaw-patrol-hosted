// Background radio. Stations don't allow their streams to be played inside
// another website (SomaFM's servers answer 403), so the radio button opens the
// station's own listening page in a small window instead.

export const RADIO_STATIONS = [
  { id: "fluid", name: "Fluid", note: "Instrumental hip hop and lo-fi beats", source: "SomaFM", page: "https://somafm.com/fluid/" },
  { id: "groovesalad", name: "Groove Salad", note: "Chilled ambient and downtempo", source: "SomaFM", page: "https://somafm.com/groovesalad/" },
  { id: "beatblender", name: "Beat Blender", note: "Late-night deep house and downtempo", source: "SomaFM", page: "https://somafm.com/beatblender/" },
  { id: "lush", name: "Lush", note: "Mellow vocals with an electronic feel", source: "SomaFM", page: "https://somafm.com/lush/" },
  { id: "dronezone", name: "Drone Zone", note: "Ambient with no beats, for deep focus", source: "SomaFM", page: "https://somafm.com/dronezone/" },
  // Public radio from Los Angeles: listener-supported, with short sponsor credits.
  { id: "kusc", name: "KUSC", note: "Classical music", source: "Classical California", page: "https://www.classicalcalifornia.org/" },
  { id: "kjazz", name: "KJAZZ 88.1", note: "Jazz and blues", source: "KJAZZ", page: "https://www.kkjz.org/programming/listen/gateway/" },
  // Your own Pandora stations. Pandora has no player other sites can embed, and it only works in the US.
  { id: "pandora", name: "Pandora", note: "Your own stations (sign in; US only)", source: "Pandora", page: "https://www.pandora.com/" },
] as const;

export type RadioStation = (typeof RADIO_STATIONS)[number]["id"];

export const isRadioStation = (v: string): v is RadioStation => RADIO_STATIONS.some((s) => s.id === v);

export const stationFor = (id: string) => RADIO_STATIONS.find((s) => s.id === id) ?? RADIO_STATIONS[0];

export const stationPage = (id: string) => stationFor(id).page;
