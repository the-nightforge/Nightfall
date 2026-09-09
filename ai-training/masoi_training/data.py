"""Đọc dataset đã encode bởi `npm run ai:encode`.

BOT_SELF_LEARNING §39: Python chỉ TRAIN. Nó không parse trajectory, không biết
luật game, và không có bản sao nào của observation encoder — encoder sống một
mình ở TypeScript, cạnh knowledge boundary. Ở đây chỉ có `np.fromfile`.

Chia train/validation/test đã được quyết ở tầng TS theo VÁN (§15); cột `splits`
chỉ là kết quả đã chốt, nên không có đường nào để một ván rơi vào hai phần.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SPLIT_NAMES = ("train", "validation", "test")


@dataclass(frozen=True)
class Dataset:
    features: np.ndarray  # (N, obs_size) float32
    masks: np.ndarray  # (N, action_size) bool
    actions: np.ndarray  # (N,) int64
    rewards: np.ndarray  # (N,) float32, ±1
    splits: np.ndarray  # (N,) uint8, 0=train 1=validation 2=test
    roles: np.ndarray  # (N,) uint8, chỉ số trong meta["roles"]
    meta: dict

    @property
    def obs_size(self) -> int:
        return int(self.meta["obsSize"])

    @property
    def action_size(self) -> int:
        return int(self.meta["actionSize"])

    def split(self, name: str) -> "Dataset":
        if name not in SPLIT_NAMES:
            raise ValueError(f"split không hợp lệ: {name!r} (có: {SPLIT_NAMES})")
        keep = self.splits == SPLIT_NAMES.index(name)
        return Dataset(
            features=self.features[keep],
            masks=self.masks[keep],
            actions=self.actions[keep],
            rewards=self.rewards[keep],
            splits=self.splits[keep],
            roles=self.roles[keep],
            meta=self.meta,
        )

    def __len__(self) -> int:
        return int(self.features.shape[0])


def load(directory: str | Path) -> Dataset:
    root = Path(directory)
    meta = json.loads((root / "meta.json").read_text(encoding="utf8"))
    rows = int(meta["rows"])
    obs_size = int(meta["obsSize"])
    action_size = int(meta["actionSize"])

    features = np.fromfile(root / "features.f32.bin", dtype="<f4")
    masks = np.fromfile(root / "masks.u8.bin", dtype=np.uint8)
    actions = np.fromfile(root / "actions.i32.bin", dtype="<i4")
    rewards = np.fromfile(root / "rewards.i8.bin", dtype=np.int8)
    splits = np.fromfile(root / "splits.u8.bin", dtype=np.uint8)
    roles = np.fromfile(root / "roles.u8.bin", dtype=np.uint8)

    # Kiểm kích thước trước khi reshape: một file cụt sẽ reshape ra ma trận lệch
    # hàng và train im lặng trên dữ liệu sai lệch một dòng.
    expected = {
        "features": (features.size, rows * obs_size),
        "masks": (masks.size, rows * action_size),
        "actions": (actions.size, rows),
        "rewards": (rewards.size, rows),
        "splits": (splits.size, rows),
        "roles": (roles.size, rows),
    }
    for name, (got, want) in expected.items():
        if got != want:
            raise ValueError(f"{name}: {got} phần tử, chờ {want} — dataset không khớp meta.json")

    return Dataset(
        features=features.reshape(rows, obs_size),
        masks=masks.reshape(rows, action_size).astype(bool),
        actions=actions.astype(np.int64),
        rewards=rewards.astype(np.float32),
        splits=splits,
        roles=roles,
        meta=meta,
    )


def action_distribution(data: Dataset) -> dict[int, int]:
    """§43: tần suất từng lớp hành động. Xem TRƯỚC khi chọn cách cân lớp."""
    values, counts = np.unique(data.actions, return_counts=True)
    return {int(v): int(c) for v, c in zip(values, counts)}
