import { CONTENT } from '../content';
import type { Content } from '../content/types';
import type { GameMap } from '../map';
import type { InstanceSpec, World } from '../state';
import { createAreaWorld, makeArea } from '../systems/world';

/**
 * client が描くための World の写し。地形・出口などは手元で作り、動くもの（人・魔物・落とし物・NPC）はサーバーから来る。
 */
export function createMirrorWorld(areaId: string, opts: { map?: GameMap; spec?: InstanceSpec | null; content?: Content } = {}): World {
  const content = opts.content ?? CONTENT;
  let w: World;
  if (opts.spec && opts.map) {
    // インスタンス（ダンジョン・塔・レイド）は地図をサーバーから受け取る。仮のワールドは地図のある開始エリアで作る
    // （'instance' などの地図を持たないエリア id で作ると、地図の組み立てで落ちてダンジョンに入れない）
    w = createAreaWorld({ areaId: content.balance.world.startArea, seed: 1, content });
    const kind = opts.spec.kind;
    w.area = makeArea(w, kind, '', opts.map, { x: opts.map.width / 2, y: opts.map.height / 2 }, [1, 1]);
  } else {
    w = createAreaWorld({ areaId, seed: 1, content });
  }
  w.area.monsters = [];
  w.area.drops = [];
  w.area.npcs = [];
  w.area.nodes = [];
  w.area.strikes = [];
  w.area.projectiles = [];
  w.area.spawns = [];
  w.players = [];
  w.pets = [];
  w.events = [];
  return w;
}
