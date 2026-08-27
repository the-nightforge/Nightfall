const playerRoomTails = new Map<string, Promise<void>>();

export async function withPlayerRoomLock<T>(
  playerId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = playerRoomTails.get(playerId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  playerRoomTails.set(playerId, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (playerRoomTails.get(playerId) === tail) {
      playerRoomTails.delete(playerId);
    }
  }
}
