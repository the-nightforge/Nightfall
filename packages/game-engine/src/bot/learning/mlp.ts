import {
  actionNames,
  actionSize,
  observationFeatureNames,
  observationSize,
} from "./observation";

/**
 * Forward pass MLP thuần TypeScript, đồng bộ, tất định.
 *
 * Vì sao không nạp ONNX ở runtime: package này phải thuần (không I/O),
 * `onnxruntime-node` chỉ có API bất đồng bộ trong khi `BotRuntime.decide*` là
 * đồng bộ, và model chỉ là ba phép nhân ma trận (~94k tham số). Định dạng
 * `masoi-mlp-1`/`masoi-mlp-2` do `ai-training/masoi_training/export.py` xuất.
 */

export interface MlpLinear {
  /** `[out][in]`, đúng thứ tự `nn.Linear.weight`. */
  w: number[][];
  b: number[];
}

/** Tham số một LayerNorm: `gamma` (`w`) và `beta` (`b`), dài `hidden`. */
export interface MlpNormLayer {
  w: number[];
  b: number[];
}

export interface MlpWeightsJson {
  format: "masoi-mlp-1" | "masoi-mlp-2";
  modelId: string;
  gitCommit?: string | null;
  datasetVersion?: string | null;
  trainingSeed?: number;
  obsSize: number;
  actionSize: number;
  hidden: number;
  featureNames: string[];
  actionNames: string[];
  layers: MlpLinear[];
  policyHead: MlpLinear;
  valueHead?: MlpLinear;
  /**
   * Vắng = `"relu"` (file v1). v2 ghi rõ để forward không bao giờ đoán.
   */
  activation?: "relu" | "silu";
  /**
   * Vắng = `"none"` (file v1). `"layernorm"` đòi `normLayers` kèm theo.
   */
  norm?: "none" | "layernorm";
  /**
   * Vắng = `"shared"` — value đọc từ trunk chính. `"separate"` đòi `valueLayers`
   * (và `valueNormLayers` khi `norm` là layernorm).
   */
  valueTrunk?: "shared" | "separate";
  /**
   * Trunk riêng của value, cùng cấu trúc `layers`: Linear → (LN) → Act mỗi block.
   * Chỉ có khi `valueTrunk === "separate"`.
   */
  valueLayers?: MlpLinear[];
  /** Gamma/beta cho `valueLayers`, một mục mỗi block khi layernorm. */
  valueNormLayers?: MlpNormLayer[];
  /**
   * Một mục mỗi trunk block, theo đúng thứ tự `layers`. Chỉ có khi
   * `norm === "layernorm"`.
   */
  normLayers?: MlpNormLayer[];
  /**
   * Có mặt = model là RESIDUAL (spec 2026-09-09-residual-policy D2): logits là
   * phần hiệu chỉnh cộng vào điểm heuristic với hệ số `beta`, không phải
   * logits thay teacher. Nằm trong file để benchmark/replay không bao giờ
   * dùng sai β — một model residual chạy với β khác β lúc train là một con
   * số vô nghĩa, và cờ CLI là chỗ dễ quên nhất.
   */
  residual?: { beta: number };
}

export interface LearnedPolicy {
  readonly id: string;
  /** logits dài `actionSize`, CHƯA mask. Thuần, đồng bộ, tất định. */
  logits(features: readonly number[]): number[];
  /** value head (tanh) nếu model có, ngược lại `null`. */
  value(features: readonly number[]): number | null;
  /** Xem `MlpWeightsJson.residual`. Vắng = policy logits thuần. */
  readonly residual?: { beta: number };
}

function linear(layer: MlpLinear, x: readonly number[]): number[] {
  const out = new Array<number>(layer.w.length);
  for (let i = 0; i < layer.w.length; i += 1) {
    const row = layer.w[i]!;
    let sum = layer.b[i]!;
    for (let j = 0; j < row.length; j += 1) sum += row[j]! * x[j]!;
    out[i] = sum;
  }
  return out;
}

function relu(x: number[]): number[] {
  for (let i = 0; i < x.length; i += 1) if (x[i]! < 0) x[i] = 0;
  return x;
}

function silu(x: number[]): number[] {
  for (let i = 0; i < x.length; i += 1) x[i] = x[i]! / (1 + Math.exp(-x[i]!));
  return x;
}

/** Khớp `torch.nn.LayerNorm` mặc định (eps 1e-5), tính trên toàn hàng. */
const LAYER_NORM_EPS = 1e-5;

function layerNorm(x: number[], gamma: readonly number[], beta: readonly number[]): number[] {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  let variance = 0;
  for (const v of x) variance += (v - mean) * (v - mean);
  variance /= x.length;
  const inv = 1 / Math.sqrt(variance + LAYER_NORM_EPS);
  for (let i = 0; i < x.length; i += 1) {
    x[i] = (x[i]! - mean) * inv * gamma[i]! + beta[i]!;
  }
  return x;
}

function forwardBlocks(
  layers: readonly MlpLinear[],
  norms: readonly MlpNormLayer[],
  useNorm: boolean,
  activation: "relu" | "silu",
  x: readonly number[],
): number[] {
  let h: number[] = [...x];
  for (let i = 0; i < layers.length; i += 1) {
    h = linear(layers[i]!, h);
    if (useNorm) {
      const nl = norms[i]!;
      h = layerNorm(h, nl.w, nl.b);
    }
    h = activation === "silu" ? silu(h) : relu(h);
  }
  return h;
}

export function mlpForward(
  weights: MlpWeightsJson,
  x: readonly number[],
): { logits: number[]; value: number | null } {
  const activation = weights.activation ?? "relu";
  const useNorm = weights.norm === "layernorm";
  const h = forwardBlocks(
    weights.layers,
    useNorm ? (weights.normLayers ?? []) : [],
    useNorm,
    activation,
    x,
  );
  const logits = linear(weights.policyHead, h);
  let value: number | null = null;
  if (weights.valueHead) {
    const vh =
      weights.valueTrunk === "separate"
        ? forwardBlocks(
            weights.valueLayers ?? [],
            useNorm ? (weights.valueNormLayers ?? []) : [],
            useNorm,
            activation,
            x,
          )
        : h;
    value = Math.tanh(linear(weights.valueHead, vh)[0]!);
  }
  return { logits, value };
}

function checkLinear(name: string, layer: unknown, rows: number, cols: number): MlpLinear {
  const l = layer as Partial<MlpLinear> | null;
  if (!l || !Array.isArray(l.w) || !Array.isArray(l.b)) throw new Error(`${name}: thiếu w/b`);
  if (l.w.length !== rows || l.b.length !== rows) {
    throw new Error(`${name}: chờ ${rows} hàng, nhận w=${l.w.length} b=${l.b.length}`);
  }
  for (const row of l.w) {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new Error(`${name}: hàng phải dài ${cols}`);
    }
  }
  return l as MlpLinear;
}

function checkNormLayer(name: string, nl: unknown, dim: number): MlpNormLayer {
  const n = nl as Partial<MlpNormLayer> | null;
  if (!n || !Array.isArray(n.w) || !Array.isArray(n.b)) {
    throw new Error(`${name}: thiếu w/b`);
  }
  if (n.w.length !== dim || n.b.length !== dim) {
    throw new Error(`${name}: chờ ${dim} chiều`);
  }
  return n as MlpNormLayer;
}

function sameList(name: string, got: unknown, want: readonly string[]): void {
  if (!Array.isArray(got) || got.length !== want.length || got.some((v, i) => v !== want[i])) {
    throw new Error(
      `${name} không khớp encoder hiện tại — model này train trên schema khác, từ chối nạp`,
    );
  }
}

/**
 * Nạp và KIỂM một model. Từ chối mọi lệch schema thay vì chạy sai: một model
 * 365 chiều nạp lên encoder 413 chiều sẽ ra số, và số đó không có nghĩa.
 */
export function loadMlpPolicy(
  json: unknown,
  options: { maxSeats?: number } = {},
): LearnedPolicy {
  const w = json as Partial<MlpWeightsJson> | null;
  if (!w || (w.format !== "masoi-mlp-1" && w.format !== "masoi-mlp-2")) {
    throw new Error("format không phải masoi-mlp-1/2");
  }
  const obs = observationSize(options.maxSeats);
  const act = actionSize(options.maxSeats);
  if (w.obsSize !== obs) throw new Error(`obsSize ${w.obsSize} ≠ encoder ${obs}`);
  if (w.actionSize !== act) throw new Error(`actionSize ${w.actionSize} ≠ encoder ${act}`);
  sameList("featureNames", w.featureNames, observationFeatureNames(options.maxSeats));
  sameList("actionNames", w.actionNames, actionNames(options.maxSeats));
  if (!Array.isArray(w.layers) || w.layers.length === 0) throw new Error("layers rỗng");
  const activation = w.activation ?? "relu";
  if (activation !== "relu" && activation !== "silu") {
    throw new Error(`activation lạ: ${String(w.activation)}`);
  }
  const norm = w.norm ?? "none";
  if (norm !== "none" && norm !== "layernorm") {
    throw new Error(`norm lạ: ${String(w.norm)}`);
  }
  let normLayers: MlpNormLayer[] | undefined;
  if (norm === "layernorm") {
    if (!Array.isArray(w.normLayers) || w.normLayers.length !== w.layers.length) {
      throw new Error("normLayers phải có một mục mỗi trunk block");
    }
  }
  let width = obs;
  const layers = w.layers.map((layer, i) => {
    const rows = (layer as MlpLinear).w?.length ?? 0;
    const checked = checkLinear(`layers[${i}]`, layer, rows, width);
    width = rows;
    return checked;
  });
  if (norm === "layernorm") {
    normLayers = w.normLayers!.map((nl, i) => checkNormLayer(`normLayers[${i}]`, nl, layers[i]!.w.length));
  }
  const policyHead = checkLinear("policyHead", w.policyHead, act, width);
  const valueHead = w.valueHead ? checkLinear("valueHead", w.valueHead, 1, width) : undefined;
  const valueTrunk = w.valueTrunk ?? "shared";
  if (valueTrunk !== "shared" && valueTrunk !== "separate") {
    throw new Error(`valueTrunk lạ: ${String(w.valueTrunk)}`);
  }
  let valueLayers: MlpLinear[] | undefined;
  let valueNormLayers: MlpNormLayer[] | undefined;
  if (valueTrunk === "separate") {
    if (!Array.isArray(w.valueLayers) || w.valueLayers.length !== layers.length) {
      throw new Error("valueLayers phải có một mục mỗi trunk block");
    }
    valueLayers = w.valueLayers.map((layer, i) =>
      checkLinear(
        `valueLayers[${i}]`,
        layer,
        layers[i]!.w.length,
        i === 0 ? obs : layers[i - 1]!.w.length,
      ),
    );
    if (norm === "layernorm") {
      if (!Array.isArray(w.valueNormLayers) || w.valueNormLayers.length !== layers.length) {
        throw new Error("valueNormLayers phải có một mục mỗi trunk block");
      }
      valueNormLayers = w.valueNormLayers.map((nl, i) =>
        checkNormLayer(`valueNormLayers[${i}]`, nl, layers[i]!.w.length),
      );
    }
  }
  let residual: { beta: number } | undefined;
  if (w.residual !== undefined) {
    const beta = (w.residual as { beta?: unknown } | null)?.beta;
    if (typeof beta !== "number" || !Number.isFinite(beta) || beta <= 0) {
      throw new Error("residual.beta phải là số hữu hạn > 0");
    }
    residual = { beta };
  }
  const weights: MlpWeightsJson = {
    ...(w as MlpWeightsJson),
    layers,
    policyHead,
    valueHead,
    activation,
    norm,
    ...(normLayers ? { normLayers } : {}),
    valueTrunk,
    ...(valueLayers ? { valueLayers } : {}),
    ...(valueNormLayers ? { valueNormLayers } : {}),
  };
  const id = typeof w.modelId === "string" ? w.modelId : "unnamed";

  const guard = (x: readonly number[]): void => {
    if (x.length !== obs) throw new Error(`features phải có ${obs} chiều, nhận ${x.length}`);
  };
  return {
    id,
    ...(residual ? { residual } : {}),
    logits(features) {
      guard(features);
      return mlpForward(weights, features).logits;
    },
    value(features) {
      guard(features);
      return mlpForward(weights, features).value;
    },
  };
}
