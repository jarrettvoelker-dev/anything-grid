import { migrateV1, sizeOf, dimsOf, type GridDoc } from "./types";

/* M1 的持久化：全部在 localStorage。
   M2 换成服务端后，这里退化成"草稿箱"与"我的网格索引"，接口保持不变。

   注意：读档一律过 migrateV1 —— 老用户的 v1 存档不能因为模型升级而丢失。 */

const KEY_MINE = "ag.mine.v1";
const KEY_DOC = (id: string) => `ag.doc.${id}`;

/** 列表项只存展示所需的最小信息，别把整份文档塞进索引。 */
export type MineEntry = {
  id: string;
  title: string;
  size: number;
  /** 2 = 行列；3 = 三轴 */
  dims: number;
  updatedAt: number;
  status: GridDoc["status"];
};

export function listMine(): MineEntry[] {
  try {
    const raw = localStorage.getItem(KEY_MINE);
    if (!raw) return [];
    const arr = JSON.parse(raw) as MineEntry[];
    return Array.isArray(arr) ? arr.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function saveDoc(doc: GridDoc): void {
  try {
    localStorage.setItem(KEY_DOC(doc.id), JSON.stringify({ ...doc, updatedAt: Date.now() }));
    const mine = listMine().filter((m) => m.id !== doc.id);
    mine.unshift({
      id: doc.id,
      title: doc.title,
      size: sizeOf(doc),
      dims: dimsOf(doc),
      updatedAt: Date.now(),
      status: doc.status,
    });
    localStorage.setItem(KEY_MINE, JSON.stringify(mine.slice(0, 200)));
  } catch {
    /* 隐私模式下 localStorage 会抛异常 —— 静默降级，不让存档失败打断游戏 */
  }
}

export function loadDoc(id: string): GridDoc | null {
  try {
    const raw = localStorage.getItem(KEY_DOC(id));
    const doc = raw ? migrateV1(JSON.parse(raw)) : null;
    if (!doc) return null;
    /* saveDoc 是按 doc.id 写的。存档里的 id 与取它的键不符时（导入的题、手改过的
       链接、早期版本的脏数据），后续保存会静默写到另一个键上 —— 玩家的作答就白填了。
       以键为准，就地纠正。 */
    return doc.id === id ? doc : { ...doc, id };
  } catch {
    return null;
  }
}

export function deleteDoc(id: string): void {
  try {
    localStorage.removeItem(KEY_DOC(id));
    localStorage.setItem(KEY_MINE, JSON.stringify(listMine().filter((m) => m.id !== id)));
  } catch {
    /* 同上 */
  }
}

/** 难猜的短 id：M2 交给服务端生成，这里先保证本地唯一且不可枚举。 */
export function newId(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}
