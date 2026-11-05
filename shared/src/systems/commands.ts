import { emote, requestMatch, requestRescue, say } from './social';
import type { Command, Player, World } from '../state';
import {
  allocateStat, choosePersonal, learnSkill, loadBuild, rebirth, respec, saveBuild, setSkillSlot,
} from './progression';
import {
  buy, deposit, depositBag, equipItem, expandStorage, insertCrystal, refineItem, removeCrystal, sellBag, sellItem,
  setAppearance, setLootFilter, sortItems, unequipItem, useItem, withdraw, withdrawBag,
} from './items';
import { nearRole } from './interact';
import { notice } from './util';
import { setCounterMax } from './counters';
import { enterDungeon, enterRaid, enterTower, leaveInstance } from './instance';
import { claimMission, equipTitle } from './quest';
import { buildFacility, payUpkeep } from './base';
import { alchemy, cook, craftItem } from './crafting';
import { capture, inheritPet, releasePet, setActivePet, setPetRole } from './pets';

/**
 * プレイヤーのコマンド（装備・ステ振り・スキル習得など）を処理する。
 * client は状態を直接書き換えず、必ずここを通す（サーバーでも同じ処理になる）。
 */
export function applyCommand(w: World, p: Player, cmd: Command) {
  const c = w.content;
  const ch = p.char;
  let err: string | null = null;
  let changed = true;
  switch (cmd.type) {
    case 'equip': err = equipItem(w, ch, cmd.uid); if (!err) w.events.push({ type: 'equip', playerId: p.id }); break;
    case 'unequip': err = unequipItem(w, ch, cmd.slot); if (!err) w.events.push({ type: 'equip', playerId: p.id }); break;
    case 'allocateStat': err = allocateStat(ch, cmd.stat, cmd.amount, c); break;
    case 'choosePersonal': err = choosePersonal(ch, cmd.personal, c); break;
    case 'learnSkill': err = learnSkill(ch, cmd.skill, c); break;
    case 'setSkillSlot': err = setSkillSlot(ch, cmd.weapon, cmd.slot, cmd.skill, c); break;
    case 'respec':
      err = nearRole(w, p, 'memory') ? respec(ch, c) : 'err.notNear';
      if (!err) { p.skillCd = {}; notice(w, p.id, 'notice.respec'); }
      break;
    case 'saveBuild':
      err = nearRole(w, p, 'memory') ? saveBuild(ch, cmd.slot, c, cmd.name) : 'err.notNear';
      if (!err) notice(w, p.id, 'notice.buildSaved', cmd.slot + 1);
      break;
    case 'loadBuild':
      err = nearRole(w, p, 'memory') ? loadBuild(ch, cmd.slot, c, (uid) => { equipItem(w, ch, uid); }) : 'err.notNear';
      if (!err) { p.skillCd = {}; notice(w, p.id, 'notice.buildLoaded', cmd.slot + 1); w.events.push({ type: 'equip', playerId: p.id }); }
      break;
    case 'rebirth':
      err = nearRole(w, p, 'rebirth') ? rebirth(ch, c) : 'err.notNear';
      if (!err) { p.skillCd = {}; w.events.push({ type: 'levelUp', playerId: p.id, level: ch.level }); notice(w, p.id, 'notice.rebirth', ch.rebirths); setCounterMax(w, p, 'rebirths', ch.rebirths); }
      break;
    case 'useItem': err = useItem(w, p, cmd.id); break;
    case 'sell': err = sellItem(w, p, cmd.uid); break;
    case 'sellBag': err = sellBag(w, p, cmd.id, cmd.n); break;
    case 'buy': err = buy(w, p, cmd.shop, cmd.id, cmd.n); break;
    case 'refine': err = nearRole(w, p, 'smith') ? refineItem(w, p, cmd.uid) : 'err.notNear'; break;
    case 'insertCrystal': err = nearRole(w, p, 'smith') ? insertCrystal(ch, cmd.uid, cmd.socket, cmd.crystal, c) : 'err.notNear'; break;
    case 'removeCrystal': err = nearRole(w, p, 'smith') ? removeCrystal(ch, cmd.uid, cmd.socket, cmd.recover, c) : 'err.notNear'; break;
    case 'deposit': err = nearRole(w, p, 'storage') ? deposit(w, ch, cmd.uid) : 'err.notNear'; break;
    case 'withdraw': err = nearRole(w, p, 'storage') ? withdraw(w, ch, cmd.uid) : 'err.notNear'; break;
    case 'depositBag': err = nearRole(w, p, 'storage') ? depositBag(w, ch, cmd.id, cmd.n) : 'err.notNear'; break;
    case 'withdrawBag': err = nearRole(w, p, 'storage') ? withdrawBag(w, ch, cmd.id, cmd.n) : 'err.notNear'; break;
    case 'expandStorage': err = nearRole(w, p, 'storage') ? expandStorage(w, ch) : 'err.notNear'; break;
    case 'sortInventory': ch.inventory = sortItems(ch.inventory, cmd.key); break;
    case 'setAppearance': err = setAppearance(ch, cmd.slot, cmd.look, c); break;
    case 'setLootFilter': err = setLootFilter(ch, cmd.hideBelow, cmd.sellBelow); break;
    case 'fastTravel': {
      const def = c.areas[cmd.town];
      if (!nearRole(w, p, 'travel')) { err = 'err.notNear'; break; }
      if (!def || def.type !== 'town' || !ch.visitedTowns.includes(cmd.town)) { err = 'err.invalid'; break; }
      if (cmd.town === w.area.id) { err = 'err.invalid'; break; }
      const cost = def.travelCost ?? 0;
      if (ch.gold < cost) { err = 'err.gold'; break; }
      ch.gold -= cost;
      w.events.push({ type: 'gold', playerId: p.id, amount: -cost });
      p.transition = { to: cmd.town, spawn: '' };
      break;
    }
    case 'enterDungeon': {
      const gate = w.area.npcs.find((n) => n.npc === 'dungeon_gate' && Math.hypot(n.x - p.x, n.y - p.y) <= c.balance.player.interactRange + 0.6);
      err = gate && gate.data === cmd.dungeon ? enterDungeon(w, p, cmd.dungeon, cmd.difficulty) : 'err.notNear';
      break;
    }
    case 'enterTower': err = nearRole(w, p, 'tower') ? enterTower(w, p, cmd.floor) : 'err.notNear'; break;
    case 'enterRaid': err = nearRole(w, p, 'raid') ? enterRaid(w, p, cmd.raid, cmd.difficulty) : 'err.notNear'; break;
    case 'leaveInstance': err = leaveInstance(w, p); break;
    case 'claimMission': err = claimMission(w, p, cmd.kind, cmd.index); break;
    case 'equipTitle': err = equipTitle(ch, cmd.title); break;
    case 'buildFacility': err = nearRole(w, p, 'base') ? buildFacility(w, p, cmd.facility) : 'err.notNear'; break;
    case 'payUpkeep': err = nearRole(w, p, 'base') ? payUpkeep(w, p) : 'err.notNear'; break;
    case 'craft': err = nearRole(w, p, 'smith') ? craftItem(w, p, cmd.tier, cmd.base) : 'err.notNear'; break;
    case 'cook': err = nearRole(w, p, 'kitchen') ? cook(w, p, cmd.recipe) : 'err.notNear'; break;
    case 'alchemy': err = nearRole(w, p, 'smith') ? alchemy(w, p, cmd.uid, cmd.mode, cmd.index) : 'err.notNear'; break;
    case 'capture': err = capture(w, p, cmd.item); break;
    case 'say': err = say(w, p, cmd.text); break;
    case 'emote': err = emote(w, p, cmd.emote); break;
    case 'rescue': err = requestRescue(w, p); break;
    case 'matchDungeon': err = requestMatch(w, p, cmd.dungeon, cmd.difficulty, !!cmd.cancel); break;
    case 'skipTutorial': p.char.tutorial.done = true; w.events.push({ type: 'tutorial', playerId: p.id, step: p.char.tutorial.step, done: true }); break;
    case 'setActivePet': err = setActivePet(p, cmd.uid); break;
    case 'setPetRole': err = setPetRole(p, cmd.uid, cmd.role); break;
    case 'inheritPet': err = inheritPet(w, p, cmd.base, cmd.material, cmd.skill, cmd.slot); break;
    case 'releasePet': err = releasePet(p, cmd.uid); break;
    case 'lock': {
      const it = ch.inventory.find((x) => x.uid === cmd.uid) ?? Object.values(ch.equipment).find((x) => x?.uid === cmd.uid);
      if (it) it.locked = cmd.locked; else err = 'err.invalid';
      break;
    }
    default: changed = false;
  }
  if (err) { notice(w, p.id, err); return; }
  if (changed) {
    p.statsDirty = true;
    w.events.push({ type: 'charChanged', playerId: p.id });
  }
}
