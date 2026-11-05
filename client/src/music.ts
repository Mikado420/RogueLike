import { CONTENT, currentWeather, dayPhase, type Player, type World } from '../../shared/src';

/** data/music.json の決まりで、今流す曲を選ぶ（上から順に最初に合ったもの） */
export function pickTrack(w: World, me: Player): string {
  const phase = dayPhase(w);
  const weather = currentWeather(w);
  const rare = !!CONTENT.weather.types[weather]?.rare;
  const boss = w.area.monsters.some((m) => CONTENT.monsters[m.defId].boss && !m.dead && m.ai === 'chase' && m.targetId === me.id);
  for (const r of CONTENT.music.rules) {
    if (r.boss !== undefined && r.boss !== boss) continue;
    if (r.rareWeather !== undefined && r.rareWeather !== rare) continue;
    if (r.areaType && r.areaType !== w.area.type) continue;
    if (r.area && r.area !== w.area.id) continue;
    if (r.phase && r.phase !== phase) continue;
    if (r.weather && r.weather !== weather) continue;
    return r.track;
  }
  return 'field';
}
