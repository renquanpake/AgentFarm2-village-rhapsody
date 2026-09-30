// types.ts —— 共享数据结构（v4 存档格式，Cocos2d 原版格式兼容）
import type WebSocket from 'ws';

export type BucketKind = 'world' | 'player' | 'global';

export interface OnlinePlayer {
  ws: WebSocket;
  uid: string;
  nick: string;
  scene: number;
  x: number;
  y: number;
}

export interface Account {
  salt: string;
  hash: string;
  uid: string;
  nick: string;
  token: string;
  agentToken?: string;
  createdAt: number;
}

export interface KvItem { id: number; num: number; }
export interface Knap { props?: KvItem[]; [k: string]: unknown; }
export interface PlayerData {
  uID?: number | string;
  nickName?: string;
  day?: number;
  time?: number;
  weatherType?: number;
  sceneType?: number;
  posSceneType?: number;
  playerPos?: { x: number; y: number; z?: number };
  houseId?: number;
  [k: string]: unknown;
}
export interface PlantRec {
  uId: number;
  plantId: number;
  x: number;
  y: number;
  hp?: number;
  farmType?: number;
  growDay?: number;
  sownAt?: number;
  [k: string]: unknown;
}
export interface PlotRec {
  x: number;
  y: number;
  plantUID?: number;
  farmType?: number;
  owner?: string;
  [k: string]: unknown;
}
export interface SprinklerRec { x: number; y: number; level?: number; owner: string; }
export interface FarmDef {
  LEFT?: number;
  TOP?: number;
  waterW: number;
  waterH: number;
  soilW: number;
  soilH: number;
  water: number[];
  plantSoils: number[];
}
export interface CollisionDef { width: number; height: number; blocked: number[]; }
export interface ItemDef {
  id: number;
  name?: string;
  sell_price?: number;
  type?: number;
  param1?: number;
  [k: string]: unknown;
}
export interface NpcDef { id: number; name?: string; [k: string]: unknown; }
export interface HouseDef {
  id: number;
  type?: string;
  door: { x: number; y: number };
  rect: { x: number; y: number; w: number; h: number };
}
export interface SpawnDef { scene?: number; houses: HouseDef[]; }
export interface MineSpot { gx: number; gy: number; }
export interface SocialPair {
  fav: Record<string, number>;
  relation?: string;
  relBy?: string;
  dmUnlocked?: boolean;
  dmNick?: string;
  dmNickBy?: string;
}
export interface SocialData { pairs: Record<string, SocialPair>; }
export interface DmEntry { from: string; nick: string; text: string; at: number; agent?: boolean; }
export interface ChatEntry { nick: string; text: string; at: number; isAgent?: boolean; }
export interface InboxEntry { from: string; text: string; at: number; }
export interface AgentPos { x: number; y: number; scene: number; }
export interface CropDef { name: string; plantId: number; cropItemId: number; days: number; }
export interface SaveDoc { version: number; datas: Array<{ key: string; val: unknown }>; [k: string]: unknown; }
