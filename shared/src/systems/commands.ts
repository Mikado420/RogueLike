import type { Command, Player, World } from '../state';
import {
  allocateStat, choosePersonal, learnSkill, loadBuild, rebirth, respec, saveBuild, setSkillSlot,
} from './progression';
import { buy, equipItem, sellBag, sellItem, unequipItem, useItem } from './items';
import { nearRole } from './interact';
import { notice } from './util';

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
      if (!err) { p.skillCd = {}; w.events.push({ type: 'levelUp', playerId: p.id, level: ch.level }); notice(w, p.id, 'notice.rebirth', ch.rebirths); }
      break;
    case 'useItem': err = useItem(w, p, cmd.id); break;
    case 'sell': err = sellItem(w, p, cmd.uid); break;
    case 'sellBag': err = sellBag(w, p, cmd.id, cmd.n); break;
    case 'buy': err = buy(w, p, cmd.shop, cmd.id, cmd.n); break;
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
