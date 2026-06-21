import { randomUUID } from "crypto";

const adjectives = [
  "friendly", "clever", "brave", "quiet", "funny", "happy", "wise", "bright",
  "gentle", "speedy", "calm", "cheerful", "polite", "bold", "silent", "sleepy",
  "playful", "lucky", "kind", "proud", "witty", "jolly", "fancy", "silly",
  "honest", "eager", "lively", "merry", "cozy"
];

const nouns = [
  "panda", "koala", "tiger", "dolphin", "penguin", "fox", "falcon", "owl",
  "otter", "badger", "rabbit", "deer", "squirrel", "hedgehog", "turtle",
  "puppy", "kitten", "parrot", "monkey", "lion", "bear", "seal", "panther",
  "sloth", "hamster", "camel", "giraffe", "lemur", "sparrow", "eagle", "whale"
];

export function generateId(prefix?: string): string {
  if (prefix === "sess") {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(100 + Math.random() * 900);
    return `sess_${adj}-${noun}-${num}`;
  }
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid.replace(/-/g, "")}` : uuid;
}
