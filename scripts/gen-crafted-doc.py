#!/usr/bin/env python3
"""銘入り装備の一覧案（docs/CRAFTED.md）を組み立てる。

レシピの組み合わせと数値はここで決め、条件（素材をすべて使う・未使用の 16 種は複数回・ボス素材は最終段だけ・
材料は 3〜5 種・同じ地域で効果の系統が重ならない・10 武器種が各地域に 1 つずつ）を確かめてから書き出す。
使い方: python3 scripts/gen-crafted-doc.py
"""
import json
import os
from collections import Counter

ROOT = os.path.join(os.path.dirname(__file__), '..')
MAT = json.load(open(os.path.join(ROOT, 'data/materials.json')))
EQ = json.load(open(os.path.join(ROOT, 'data/equipment.json')))['bases']
name = lambda m: MAT[m]['name']

UNUSED = ['hornet_needle', 'wisp_ember', 'snake_skin', 'eel_slime', 'hydra_fang', 'rain_trout', 'ember_scale', 'bat_wing',
          'hell_fang', 'ancient_bark', 'shade_herb', 'frost_core', 'yeti_fur', 'dragon_scale', 'ice_fish', 'storm_crystal']
BOSS = {'marsh': 'hydra_fang', 'volcano': 'ember_scale', 'snow': 'dragon_scale'}

# ───── 効果の系統（名前・中身・数値の幅 [最初の地域, 最後の地域]） ─────
FAMILIES = {
    'night':   ('夜の力', '夜は攻撃・魔攻 +{a}%', (10, 25)),
    'last':    ('背水', 'HP 50% 以下で攻撃 +{a}%・会心率 +{b}', (15, 35), (4, 12)),
    'wall':    ('鉄壁', 'HP 30% 以下で防御 +{a}%・被ダメージ −{b}%', (25, 60), (6, 18)),
    'full':    ('万全', 'HP 満タンで物理・魔法ダメージ +{a}%', (6, 20)),
    'dodge':   ('回避の勢い', '回避のあと 3 秒、攻撃・魔攻 +{a}%', (10, 30)),
    'element': ('属性の加護', '{el}属性ダメージ +{a}%・状態異常の確率 +{b}%', (8, 25), (5, 15)),
    'drain':   ('吸収', '与えたダメージの {a}% を HP に', (1.5, 5)),
    'echo':    ('追撃', '命中時 {a}% でもう一撃（威力 {b}）', (5, 14), (0.4, 0.8)),
    'status':  ('状態付与', '命中時 {a}% で{st}', (5, 14)),
    'reap':    ('刈り取り', '倒すと HP を {a}% 回復', (3, 10)),
    'hurt':    ('癒しの護り', '被弾時 {a}% で HP を {b}% 回復', (6, 14), (5, 12)),
    'mana':    ('魔力の循環', '命中ごとに MP +{a}', (1, 4)),
    'hunter':  ('狩人', 'ボスへのダメージ +{a}%', (6, 20)),
    'luck':    ('幸運', 'ドロップ率 +{a}%・レア率 +{b}%', (6, 18), (4, 12)),
    'resist':  ('耐性', '状態異常への耐性 +{a}%・回復量 +{b}%', (12, 35), (4, 15)),
    # 武器の仕組みに合わせた系統（新しく足す条件）
    'charge':  ('溜めの極み', '【両手剣】最大まで溜めた一撃のダメージ +{a}%・ブレイク +{b}%', (15, 45), (10, 40)),
    'combo':   ('連打の極み', '【手甲】コンボ {n} 以上で攻撃 +{a}%・会心率 +{b}', (10, 30), (3, 10)),
    'reload':  ('装填の冴え', '【銃】再装填のあと 3 秒、攻撃 +{a}%・会心率 +{b}', (12, 35), (4, 12)),
    'rhythm':  ('拍子の高揚', '【楽器】リズム {n} 段以上で魔攻 +{a}%・命中ごとに MP +{b}', (10, 30), (1, 3)),
    'guard':   ('構えの返し', '【片手剣】防いだあと 2 秒、攻撃 +{a}%・被ダメージ −{b}%', (12, 35), (5, 15)),
    'spacing': ('間合いの妙', '【槍】最適な間合いでの命中のダメージ +{a}%', (10, 30)),
}
WEAPON_FAMILY = {'twoHandSword': 'charge', 'knuckles': 'combo', 'gun': 'reload', 'instrument': 'rhythm', 'oneHandSword': 'guard', 'spear': 'spacing',
                 'dualSwords': 'dodge', 'scythe': 'drain'}
WEAPONS = ['oneHandSword', 'twoHandSword', 'dualSwords', 'spear', 'bow', 'staff', 'knuckles', 'gun', 'scythe', 'instrument']
WBASE = {k: 'w_' + k for k in WEAPONS}
EL = {'fire': '火', 'water': '水', 'wind': '風', 'earth': '地', 'light': '光', 'dark': '闇'}
ST = {'poison': '毒', 'burn': '火傷', 'shock': '感電', 'freeze': '凍結'}

# ───── 地域 ─────
# stages: (鍛冶Lv, ティア)。並びは「序盤 6・中盤 6・最終 4」
REGIONS = [
    dict(id='meadow', name='翠風の草原', pre='翠風', lv='1–15', el=['wind', 'earth'], st='poison', stages=[(2, 0), (5, 1), (8, 1)],
         common=['slime_gel', 'boar_hide', 'spore', 'copper_ore', 'iron_ore', 'herb_green', 'oak_wood', 'river_fish', 'golem_core', 'moon_herb'],
         special=['hornet_needle', 'wisp_ember', 'snake_skin', 'rain_trout'], core='storm_crystal'),
    dict(id='marsh', name='蒼雫の湖沼', pre='蒼雫', lv='14–33', el=['water', 'dark'], st='poison', stages=[(10, 2), (13, 3), (16, 3)],
         common=['toad_oil', 'crab_shell', 'lizard_scale', 'ectoplasm', 'marsh_wood', 'swamp_eel', 'iron_ore', 'copper_ore'],
         special=['eel_slime', 'shade_herb', 'rain_trout', 'wisp_ember'], core='hydra_fang'),
    dict(id='volcano', name='紅蓮の火山', pre='灰燼', lv='32–56', el=['fire', 'earth'], st='burn', stages=[(20, 4), (24, 5), (28, 5)],
         common=['fire_scale', 'magma_core', 'ash_wood', 'fire_herb', 'lava_crab', 'iron_ore', 'mithril_ore', 'golem_core'],
         special=['bat_wing', 'hell_fang', 'storm_crystal'], core='ember_scale'),
    dict(id='forest', name='黄昏の古森', pre='黄昏', lv='52–77', el=['dark', 'earth'], st='poison', stages=[(30, 5), (33, 6), (36, 6)],
         common=['fairy_dust', 'dark_silk', 'wolf_fang', 'elder_wood', 'mithril_ore', 'star_ore', 'ectoplasm', 'moon_herb'],
         special=['ancient_bark', 'shade_herb', 'wisp_ember'], core='ancient_bark'),
    dict(id='snow', name='白銀の雪原', pre='白銀', lv='74–100', el=['water', 'wind'], st='freeze', stages=[(38, 7), (42, 8), (45, 8)],
         common=['wyvern_scale', 'snow_lotus', 'frost_wood', 'star_ore', 'mithril_ore', 'wolf_fang', 'ectoplasm'],
         special=['frost_core', 'yeti_fur', 'ice_fish', 'storm_crystal'], core='dragon_scale'),
]
# 防具・アクセサリー（各地域 6 品：頭・胴・胴・副・アクセ・アクセ）
GEAR = [['h_hood', 'a_light', 'a_cloth', 's_quiver', 'x_ring', 'x_amulet'],
        ['h_hat', 'a_heavy', 'a_light', 's_shield', 'x_earring', 'x_ring'],
        ['h_helm', 'a_heavy', 'a_cloth', 's_talisman', 'x_amulet', 'x_earring'],
        ['h_hood', 'a_cloth', 'a_light', 's_grimoire', 'x_ring', 'x_earring'],
        ['h_helm', 'a_heavy', 'a_light', 's_magazine', 'x_amulet', 'x_ring']]
# 名前の飾り（地域ごとに 16。武器 10 → 防具 6 の順）
MOTIF = [
    ['風切り', '大嵐', '蜂舞い', '若葉', '蜂針', '宵灯', '嵐呼び', '草笛', '蛇牙', '雨音', '蛇鱗', '宵闇', '野茨', '樫守り', '蜂蜜', '雨粒'],
    ['水鏡', '沼底', '鰻流し', '水妖', '雨鱒', '影草', '泡沫', '水撃ち', '沼刈り', '雫歌', '影草', '霧雨', '鰻皮', '甲羅', '水月', '雫'],
    ['灰燼', '溶岩', '炎蝙蝠', '火竜', '火矢', '熾火', '地獄', '火砲', '地獄犬', '炎の調べ', '灰', '炎衣', '溶岩鎧', '火守り', '蝙蝠', '熾り'],
    ['黄昏', '古樹', '妖精', '影縫い', '夜梟', '古樹', '狼', '闇撃ち', '影刈り', '夕暮れ', '影草', '闇糸', '妖精', '古樹', '宵星', '狼牙'],
    ['白銀竜', '氷河', '吹雪', '氷柱', '氷魚', '氷結', '雪男', '嵐撃ち', '霜刈り', '雪の調べ', '嵐晶', '雪男', '竜鱗', '霜', '氷結核', '雪華'],
]
LABEL = {**{WBASE[k]: EQ[WBASE[k]]['name'] for k in WEAPONS}, **{k: v['name'] for k, v in EQ.items()}}
# ひとこと（系統ごと）
NOTE = {
    'night': '夜の狩り向け', 'last': '追い込まれてから強い', 'wall': '前に立って踏ん張る', 'full': '被弾しない上級者向け',
    'dodge': '避けて反撃する', 'element': '属性をそろえる人向け', 'drain': '回復を挟まず戦い続ける', 'echo': '手数で押す',
    'status': '状態異常で崩す', 'reap': '群れを狩りながら回復', 'hurt': '打たれ強い盾役', 'mana': 'スキルを回し続ける',
    'hunter': 'ボス周回向け', 'luck': '素材集め・ドロップ集め向け', 'resist': '状態異常の多い場所向け',
    'charge': '溜めて大きな一撃', 'combo': 'コンボを切らさず殴り続ける', 'reload': '撃ち切って装填、の流れを強く',
    'rhythm': '拍に合わせて演奏し続ける', 'guard': '防いでから返す', 'spacing': '間合いを保つ槍使い',
}
GENERIC = ['night', 'last', 'wall', 'full', 'element', 'drain', 'echo', 'status', 'reap', 'hurt', 'mana', 'hunter', 'luck', 'resist', 'dodge']
# 防具・アクセサリー向けの系統（武器に付けると不自然なもの）
GEAR_PREF = ['wall', 'hurt', 'resist', 'luck', 'full', 'night', 'mana', 'hunter', 'reap', 'element', 'last', 'dodge']
WEAPON_PREF = ['echo', 'status', 'element', 'drain', 'hunter', 'last', 'night', 'reap', 'mana', 'full', 'dodge']


def fmt(v):
    return str(int(v)) if float(v).is_integer() else f'{v:.1f}'


def value(fam, r, s):
    """地域 r（0〜4）と段階 s（0〜2）で数値を上げる。最終段でもミシックには届かない幅にしてある"""
    t = min(1.0, (r + s * 0.4) / 4.8)
    d = FAMILIES[fam]
    out = {}
    for key, rng in zip(['a', 'b'], d[2:]):
        v = rng[0] + (rng[1] - rng[0]) * t
        out[key] = round(v * 2) / 2 if rng[1] < 10 else round(v)
    return out


rows_by_region = []
uses = Counter()
for r, R in enumerate(REGIONS):
    items = []
    # 武器 10（序盤 4・中盤 3・最終 3）と防具 6（序盤 2・中盤 3・最終 1）
    stage_w = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2]
    stage_g = [0, 0, 1, 1, 1, 2]
    order = WEAPONS[r * 3 % 10:] + WEAPONS[:r * 3 % 10]          # 地域ごとに、最終段に来る武器種を変える
    used_fams = set()
    for k, wt in enumerate(order):
        fam = WEAPON_FAMILY.get(wt)
        if fam is None or fam in used_fams:
            fam = next(f for f in WEAPON_PREF[(r + k) % len(WEAPON_PREF):] + WEAPON_PREF if f not in used_fams)
        used_fams.add(fam)
        items.append(dict(kind='weapon', wt=wt, base=WBASE[wt], stage=stage_w[k], fam=fam, motif=MOTIF[r][WEAPONS.index(wt)]))
    for k, base in enumerate(GEAR[r]):
        fam = next(f for f in GEAR_PREF[(r * 2 + k) % len(GEAR_PREF):] + GEAR_PREF if f not in used_fams)
        used_fams.add(fam)
        items.append(dict(kind='gear', base=base, stage=stage_g[k], fam=fam, motif=MOTIF[r][10 + k]))
    assert len(used_fams) == 16, R['id']

    # 材料（3〜5 種）。序盤は地域の素材、中盤から特別な素材、最終段はボス素材（核）
    ci = si = 0
    for k, it in enumerate(items):
        s = it['stage']
        mats = []
        com = R['common']
        mats.append((com[ci % len(com)], 4 + s * 2 + r)); ci += 1
        mats.append((com[ci % len(com)], 3 + s * 2 + r)); ci += 1
        sp = R['special']
        mats.append((sp[si % len(sp)], 2 + s * 2 + (r > 2))); si += 1
        if s >= 1:
            mats.append((sp[si % len(sp)], 2 + s)); si += 1
        if s == 2:
            if R['core'] in BOSS.values() or R['id'] == 'forest':
                mats.append((R['core'], 2 if it['kind'] == 'weapon' else 1))
            else:
                mats.append((R['core'], 1))
            if k % 2 == 0:
                mats[-2] = ('catalyst', 1) if r < 3 else ('golden_fish', 1)
        # 同じ素材が重ならないように
        seen = {}
        for m, n in mats:
            seen[m] = max(seen.get(m, 0), n)
        it['mats'] = list(seen.items())[:5]
        assert 3 <= len(it['mats']) <= 5, it
        for m, _ in it['mats']:
            uses[m] += 1
        lv, tier = R['stages'][s]
        it['lv'], it['tier'] = lv, tier
        it['gold'] = int(round((300 + tier * tier * 900) * (1 + s * 0.4) / 100) * 100)
        it['el'] = R['el'][k % 2]
        it['val'] = value(it['fam'], r, s)
        it['n'] = 3 + r * 4 + s * 3   # コンボ数・リズム段数の条件
    rows_by_region.append(items)

# 他の地域の素材を少し混ぜる（未使用素材を必ず複数回にするための調整は上の割り当てで足りる）
all_mats = [k for k, v in MAT.items() if v.get('kind') == 'material' and k != 'refine_stone']
missing = [m for m in all_mats if uses[m] == 0]
# 使われていない素材があれば、それぞれ地域の合う品に足す（材料が 5 種未満の品へ）
FIX_REGION = {'golden_fish': 4, 'catalyst': 2, 'herb_green': 0, 'oak_wood': 0, 'river_fish': 3, 'moon_herb': 3, 'snow_lotus': 4,
              'frost_wood': 4, 'lava_crab': 2, 'swamp_eel': 1, 'toad_oil': 1, 'copper_ore': 0, 'slime_gel': 0}
for m in missing:
    r = FIX_REGION.get(m, 0)
    for it in rows_by_region[r]:
        if len(it['mats']) < 5 and all(x != m for x, _ in it['mats']):
            it['mats'].append((m, 2)); uses[m] += 1; break
missing = [m for m in all_mats if uses[m] == 0]
assert not missing, missing
for m in UNUSED:
    assert uses[m] >= 2, (m, uses[m])
for r, R in enumerate(REGIONS):
    for it in rows_by_region[r]:
        for m, _ in it['mats']:
            if m in BOSS.values():
                assert it['stage'] == 2 and BOSS.get(R['id']) == m, (R['id'], m)
    assert sorted(x['wt'] for x in rows_by_region[r] if x['kind'] == 'weapon') == sorted(WEAPONS)
    assert len(rows_by_region[r]) == 16


def effect_text(it):
    d = FAMILIES[it['fam']]
    v = it['val']
    return d[1].format(a=fmt(v.get('a', 0)), b=fmt(v.get('b', 0)), el=EL[it['el']], st=ST[REGIONS[[x for x in range(5) if it in rows_by_region[x]][0]]['st']], n=it['n'])


out = []
out.append('# 銘入り装備（一覧案・80 品）\n')
out.append('素材で作る、名前・部位・属性・固定の効果が決まった装備。今の鍛冶とは別に、鍛冶屋の新しいタブ「銘入り」から作る。\n')
out.append('> これは案です。確認をいただいてから実装します（data/crafted.json・鍛冶屋の画面・サーバーの検証・テスト）。'
           'この文書は `scripts/gen-crafted-doc.py` で組み立てています（条件を満たしているかもスクリプトで確かめています）。\n')
out.append('## 共通のきまり\n')
out.append('- **強さ**：レジェンド相当（基礎能力の倍率 1.48）。ランダムなのはオプションの値だけで、数はレジェンドと同じ 3 つ。ミシックには届かない。')
out.append('- **固定のもの**：名前・部位・ベース・属性・固定効果・結晶スロット（序盤 1・中盤 1・最終 2）。')
out.append('- **魔石は使わない**（魔石の使い道は精錬だけ）。')
out.append('- **段階**：各地域で「序盤 6・中盤 6・最終 4」。ボス素材（ヒドラの牙・灰燼の鱗・竜鱗）は最終段の品だけに使う。草原はボス素材がないので嵐晶、古森は古樹の皮（エルダートレントも落とす）を最終段の核にする。')
out.append('- **作れる場所**：街の鍛冶屋。鍛冶 Lv・材料・ゴールドはサーバーで確かめる。足りない材料は画面に出す。\n')
out.append('## 効果の系統（21 系統）\n')
out.append('数値の幅は「最初の地域の序盤」〜「最後の地域の最終段」。同じ地域の中では系統が重ならない。【】は武器種の仕組みに合わせた系統。\n')
out.append('| 系統 | 中身 | 数値の幅 | しくみ |')
out.append('|---|---|---|---|')
HOW = {'night': 'when night（既存）', 'last': 'when hpBelow 50（既存）', 'wall': 'when hpBelow 30（既存）', 'full': 'when fullHp（既存）',
       'dodge': 'when afterDodge 3（既存）', 'element': 'mods 〇〇DmgPct・statusChancePct（既存）', 'drain': 'mods lifestealPct（既存）',
       'echo': 'proc hit → extraHit（既存）', 'status': 'proc hit → status（既存）', 'reap': 'proc kill → heal（既存）', 'hurt': 'proc hurt → heal（既存）',
       'mana': 'mods mpOnHit（既存）', 'hunter': 'mods bossDmgPct（既存）', 'luck': 'mods dropRatePct・rareRatePct（既存）',
       'resist': 'mods statusResistPct・healPct（既存）', 'charge': '**新規** when chargeMax', 'combo': '**新規** when comboAtLeast',
       'reload': '**新規** when afterReload', 'rhythm': '**新規** when rhythmAtLeast', 'guard': '**新規** when afterBlock', 'spacing': '**新規** mods sweetDmgPct'}
for k, d in FAMILIES.items():
    rng = '・'.join(f'{fmt(x[0])}〜{fmt(x[1])}' for x in d[2:])
    out.append(f'| {d[0]} | {d[1].format(a="a", b="b", el="〇", st="〇〇", n="n")} | {rng} | {HOW[k]} |')
out.append('')
STAGE = ['序盤', '中盤', '最終']
for r, R in enumerate(REGIONS):
    out.append(f'## {R["name"]}（Lv {R["lv"]}）\n')
    out.append('| 段階 | 名前 | 部位（ベース） | 鍛冶Lv | ティア | 属性 | 材料 | ゴールド | 固定効果 | ひとこと |')
    out.append('|---|---|---|---|---|---|---|---|---|---|')
    for it in sorted(rows_by_region[r], key=lambda x: (x['stage'], x['kind'] != 'weapon')):
        slot = '武器' if it['kind'] == 'weapon' else {'head': '頭', 'body': '胴', 'sub': '副', 'accessory': 'アクセ'}[EQ[it['base']]['slot']]
        star = '★' if it['stage'] == 2 else ''
        nm = f'{star}{it["motif"]}の{LABEL[it["base"]]}' if it['motif'].startswith(R['pre']) else f'{star}{R["pre"]}・{it["motif"]}の{LABEL[it["base"]]}'
        mats = '、'.join(f'{name(m)}×{n}' for m, n in it['mats'])
        out.append(f'| {STAGE[it["stage"]]} | {nm} | {slot}（{LABEL[it["base"]]}） | {it["lv"]} | {it["tier"]} | {EL[it["el"]]} | {mats} | {it["gold"]:,} | '
                   f'{FAMILIES[it["fam"]][0]}：{effect_text(it)} | {NOTE[it["fam"]]} |')
    out.append('')
out.append('## 素材ごとの使用回数\n')
out.append('魔石以外の素材 ' + str(len(all_mats)) + ' 種。使われていない素材は 0 種。★は今どこにも使われていなかった 16 種。\n')
out.append('| 素材 | 回数 |')
out.append('|---|---|')
for m in sorted(all_mats, key=lambda x: (-uses[x], x)):
    out.append(f'| {"★" if m in UNUSED else ""}{name(m)} | {uses[m]} |')
out.append('')
out.append('## 決めてほしいこと\n')
out.append('1. **取引**：作った銘入り装備は取引できるか。案は「一度だけ」（精錬済みの装備と同じ扱い）。')
out.append('2. **属性**：今の装備には属性の項目がない。案は、武器の属性は攻撃の属性に、防具・アクセサリーの属性は表示だけ。')
out.append('3. **作れる数**：同じものを何本でも作れるか。案は何本でも（オプションの値を厳選できる）。')
out.append('4. **新しい条件**：武器の仕組みに合わせて、条件を 5 つ（溜め・コンボ・再装填・リズム・防いだあと）と、効果を 1 つ（槍の最適な間合いのダメージ）足す。')
with open(os.path.join(ROOT, 'docs/CRAFTED.md'), 'w') as f:
    f.write('\n'.join(out) + '\n')
print('ok', sum(len(x) for x in rows_by_region), 'items;', 'unused-16 min uses', min(uses[m] for m in UNUSED))
