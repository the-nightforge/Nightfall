import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ROOM_CONFIG, type GameEventView, type RoomSnapshot } from "@masoi/shared";
import { EventBanner } from "../components/EventBanner";
import { NightPanel } from "../components/NightPanel";

test("EventBanner shows the public result of Judgment Day", () => {
  const event: GameEventView = {
    id: "JUDGMENT_DAY",
    name: "Ngày Phán Xét",
    description: "Công khai kết quả soi gần nhất của Thám Tử.",
    announcement: "Kết quả Thám Tử: Khải và Linh là KHÁC PHE!",
    targetPhase: "DAY",
    round: 2,
    beneficiary: "village",
    power: 3,
  };

  const html = renderToStaticMarkup(createElement(EventBanner, { event }));

  assert.match(html, /Kết quả Thám Tử: Khải và Linh là KHÁC PHE!/);
});

test("NightPanel renders an obscured Detective result as unknown", () => {
  const snapshot: RoomSnapshot = {
    code: "ECLIPSE",
    hostId: "det",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "det",
      name: "Thám Tử",
      ready: true,
      connected: true,
      role: "DETECTIVE",
      alive: true,
    },
    players: [
      { id: "det", name: "Thám Tử", alive: true, isBot: false },
      { id: "wolf", name: "Khải", alive: true, isBot: false },
      { id: "villager", name: "Linh", alive: true, isBot: false },
    ],
    night: {
      canAct: true,
      acted: true,
      detectiveResult: {
        target1: { id: "wolf", name: "Khải" },
        target2: { id: "villager", name: "Linh" },
        unknown: true,
      },
    },
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    dayVoteHistory: [],
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };

  const html = renderToStaticMarkup(
    createElement(NightPanel, { snapshot, onAction: () => undefined }),
  );

  assert.match(html, /KHÔNG THỂ XÁC ĐỊNH/);
  assert.doesNotMatch(html, /CÙNG PHE|KHÁC PHE/);
});
