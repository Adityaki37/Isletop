const adjectives = ["Swift", "Sunny", "Brave", "Lucky", "Calm", "Clever", "Merry", "Golden"];
const islands = ["Harbor", "Sailor", "Otter", "Island", "Reef", "Fox", "Voyager", "Cove"];

/** A public nickname, never an authentication secret or provider profile name. */
export function randomPlayerName() {
  const id = crypto.randomUUID().replaceAll("-", "");
  return `${adjectives[parseInt(id[0], 16) % adjectives.length]}${islands[parseInt(id[1], 16) % islands.length]}`;
}

/** Recover guest defaults if a disposable QA nickname was saved by a preview. */
export function guestPlayerName(savedName: string | null) {
  if (!savedName || /^Live QA \d+\/0$/.test(savedName)) return randomPlayerName();
  return readablePlayerName(savedName);
}

/** Strip only suffixes from the app's former generated names. Keep custom names. */
export function readablePlayerName(name: string) {
  const match = /^([a-z]+)([a-z]+)_([a-f0-9]{8})$/i.exec(name);
  if (!match) return name;
  const wordName = name.slice(0, -9);
  return adjectives.some(adjective => islands.some(island =>
    wordName.toLowerCase() === `${adjective}${island}`.toLowerCase())) ? wordName : name;
}
