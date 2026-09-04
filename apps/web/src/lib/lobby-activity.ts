export interface LobbyPresencePlayer {
  id: string;
  name: string;
  ready?: boolean;
  connected?: boolean;
  isBot?: boolean;
}

export interface LobbyPresence {
  hostId: string | null;
  players: LobbyPresencePlayer[];
}

export function captureLobbyPresence(value: LobbyPresence): LobbyPresence {
  return {
    hostId: value.hostId,
    players: value.players.map((player) => ({ ...player })),
  };
}

export function deriveLobbyActivity(before: LobbyPresence, after: LobbyPresence): string[] {
  const messages: string[] = [];
  const previous = new Map(before.players.map((player) => [player.id, player]));
  const current = new Map(after.players.map((player) => [player.id, player]));

  for (const player of after.players) {
    if (!previous.has(player.id) && !player.isBot) {
      messages.push(`${player.name} vừa bước vào làng.`);
    }
  }

  for (const player of before.players) {
    if (!current.has(player.id) && !player.isBot) {
      messages.push(`${player.name} đã rời khỏi làng.`);
    }
  }

  for (const player of after.players) {
    const old = previous.get(player.id);
    if (!old || player.isBot) continue;
    if (old.ready !== player.ready) {
      messages.push(
        player.ready ? `${player.name} đã sẵn sàng.` : `${player.name} chưa còn sẵn sàng.`,
      );
    }
    if (old.connected !== player.connected) {
      messages.push(
        player.connected
          ? `${player.name} đã quay lại làng.`
          : `${player.name} bị mất kết nối.`,
      );
    }
  }

  if (before.hostId !== after.hostId && after.hostId) {
    const host = current.get(after.hostId);
    if (host) messages.push(`${host.name} đã trở thành chủ phòng.`);
  }

  return messages;
}

export function lobbyWaitingLine(input: {
  playerCount: number;
  minimumPlayers: number;
  unreadyCount: number;
}): string {
  const missing = Math.max(0, input.minimumPlayers - input.playerCount);
  if (missing > 0) return `Đang chờ thêm ${missing} dân làng...`;
  if (input.unreadyCount > 0) return `Còn ${input.unreadyCount} người chưa sẵn sàng.`;
  return "Mọi người đã sẵn sàng. Đêm đang đến gần.";
}
