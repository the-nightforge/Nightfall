import type { BotDecisionContext } from "@masoi/game-engine";
import { generateWarnings } from "@masoi/game-engine/src/balance/analyzer";
import { visibleChatLog } from "../rooms/snapshot";
import type { Room } from "../rooms/store";

/**
 * Ghép đúng HAI nguồn đã được lọc sẵn: knowledge do engine cấp và chat log do
 * server cấp.
 *
 * File này cố tình không đọc bất cứ trường nào của `room.engine.state`. Mọi
 * quyền xem đã được quyết ở `botKnowledgeFor` và `visibleChatLog`; thêm một
 * đường đọc thứ ba ở đây là cách dễ nhất để một bí mật lọt vào lõi AI.
 */
export function buildBotDecisionContext(room: Room, botId: string): BotDecisionContext {
  if (!room.engine) throw new Error("Chưa có trận đấu");

  const balance = generateWarnings(room.config, room.members.length);

  return {
    knowledge: room.engine.botKnowledgeFor(botId),
    visibleChat: visibleChatLog(room, botId).map((message) => ({
      id: message.id,
      actorId: message.playerId,
      text: message.text,
      at: message.at,
    })),
    activeEventId: room.engine.state.activeEvent?.id ?? null,
    balanceScore: balance.score,
    pendingLastStand: room.engine.state.pendingLastStandVictim ?? null,
  };
}
